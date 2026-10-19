/** Main-screen terminal conversation, multiline editing, and foreground human input. */
import { Console } from 'node:console'
import { Writable } from 'node:stream'
import {
  Container, Editor, Input, Markdown, ProcessTerminal, SelectList, Spacer, Text, TuiMainScreen,
  matchesKey, truncateToWidth, fuzzyFilter, type Component, type Focusable, type SelectItem,
} from '@earendil-works/pi-tui'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { terminalCommands, ProjectCompletion } from './completion.ts'
import { color, editorTheme, markdownTheme, selectTheme } from './theme.ts'
import { terminalText, type TerminalEntry, type TerminalView } from './transcript.ts'

/** Keep the user's pre-existing shell scrollback during a width-change redraw. */
class ScrollbackTerminal extends ProcessTerminal {
  override write(data: string): void { super.write(data.replaceAll('\x1b[3J', '')) }
}

class PromptEditor extends Editor {
  override handleInput(data: string): void {
    if (matchesKey(data, 'enter') && this.isShowingAutocomplete()
      && terminalCommands.some(command => this.getText().trim() === `/${command.name}`)) super.handleInput('\x1b')
    super.handleInput(data)
  }

  protected override renderTopBorder(width: number): string {
    return color.dim(truncateToWidth('› Message · Enter send · Shift+Enter new line', width))
  }
  protected override renderBottomBorder(): string { return '' }
}

/** Leading lines of a long text, ending with the count of omitted lines. */
function head(value: string, lines: number): string {
  const all = value.split('\n')
  return all.length <= lines ? value : `${all.slice(0, lines).join('\n')}\n… +${all.length - lines} lines`
}

function previewLine(line: string): string {
  if (line.startsWith('+ ')) return color.green(line)
  if (line.startsWith('- ')) return color.red(line)
  return color.dim(line)
}

const TODO_MARK = { pending: '☐', in_progress: '◼', completed: '☒' } as const

class MessageBlock extends Container {
  constructor(entry: TerminalEntry) {
    super()
    switch (entry.kind) {
      case 'user':
        this.addChild(new Text(color.bold.cyan('You'), 0, 0))
        this.addChild(new Text(entry.text, 0, 0))
        break
      case 'assistant':
        this.addChild(new Text(color.bold('Assistant'), 0, 0))
        this.addChild(new Markdown(entry.text, 0, 0, markdownTheme))
        break
      case 'thinking':
        this.addChild(new Text(color.dim.italic(`✻ ${head(entry.text, 3).replaceAll('\n', '\n  ')}`), 0, 0))
        break
      case 'tool': {
        const mark = entry.state === 'failed' ? color.red('●') : entry.state === 'running' ? color.yellow('●') : color.green('●')
        this.addChild(new Text(`${mark} ${color.bold(entry.text)}`, 0, 0))
        for (const line of entry.preview ?? []) this.addChild(new Text(`  ${color.dim('⎿')} ${previewLine(line)}`, 0, 0))
        break
      }
      case 'todo':
        this.addChild(new Text(color.bold('Todos'), 0, 0))
        for (const item of entry.todos ?? []) {
          const line = `  ${TODO_MARK[item.status]} ${item.content}`
          this.addChild(new Text(item.status === 'completed' ? color.dim.strikethrough(line)
            : item.status === 'in_progress' ? color.bold(line) : line, 0, 0))
        }
        break
      case 'status':
        this.addChild(new Text(color.dim(`── ${entry.text} ──`), 0, 0))
        if (entry.details !== undefined) this.addChild(new Text(color.red(entry.details), 0, 0))
        break
      default: assertNever(entry.kind)
    }
    this.addChild(new Spacer(1))
  }
}

class InlineChoice extends Container implements Focusable {
  private readonly search = new Input({ prompt: 'Find: ', placeholder: 'type to filter · ↑↓ select · Enter confirm · Esc cancel' })
  private list: SelectList
  private readonly items: SelectItem[]
  private query = ''
  private hasFocus = false
  get focused(): boolean { return this.hasFocus }
  set focused(value: boolean) { this.hasFocus = value; this.search.focused = value }

  constructor(title: string, choices: readonly string[], private readonly rows: number,
    private readonly select: (index: number) => void, private readonly cancel: () => void) {
    super()
    this.items = choices.map((label, index) => ({ value: String(index), label: terminalText(label) }))
    this.list = this.makeList('')
    this.addChild(new Markdown(terminalText(title), 0, 0, markdownTheme))
    this.addChild(new Spacer(1))
    this.addChild(this.search)
    this.addChild(this.list)
  }

  handleInput(data: string): void {
    if ((['up', 'down', 'enter', 'escape'] as const).some(key => matchesKey(data, key))) this.list.handleInput(data)
    else {
      this.search.handleInput(data)
      const query = this.search.getValue()
      if (query !== this.query) {
        this.query = query
        this.list = this.makeList(query)
        this.children[this.children.length - 1] = this.list
      }
    }
  }

  private makeList(query: string): SelectList {
    const list = new SelectList(fuzzyFilter(this.items, query, item => item.label), Math.max(3, Math.min(8, this.rows - 8)), selectTheme)
    list.onSelect = (item) => { this.select(Number(item.value)) }
    list.onCancel = this.cancel
    return list
  }
}

/** Human actions dispatched without adding command text to the model history. */
export interface TerminalActions {
  /** Submit editor contents; accepted() clears them only after admission succeeds. */
  send(text: string): void
  /** Search persisted conversations. */
  sessions(): void
  /** Create a conversation in the invoking directory. */
  create(): void
  /** Inspect retained tool arguments and output. */
  tools(): void
  /** Stop generation in the selected conversation. */
  cancel(): void
  /** Close the terminal and its owned Web service. */
  exit(): void
}

/** Owns the terminal's raw input, rendering, console capture, and completion work. */
export class TerminalUi {
  private readonly terminal = new ScrollbackTerminal()
  private readonly tui = new TuiMainScreen(this.terminal, true)
  private readonly header = new Text('DeepSeek Harness', 0, 0)
  private readonly messages = new Container()
  private readonly live = new Container()
  private readonly liveMarkdown = new Markdown('', 0, 1, markdownTheme)
  private readonly workLabel = new Text('', 0, 0)
  private readonly interaction = new Container()
  private readonly reading = new Text('', 0, 0)
  private readonly notice = new Text('', 0, 0)
  private readonly editor: PromptEditor
  private readonly completion: ProjectCompletion
  private readonly blocks = new Map<string, { entry: TerminalEntry; component: Component }>()
  private readonly previousConsole = globalThis.console
  private readonly diagnostics: Writable
  private pending: (() => void) | undefined
  private pendingSubmission: string | undefined
  private selected: string | undefined
  private directory: string | undefined
  private closed = false
  private closing: Promise<void> | undefined
  private working = false
  private workStarted = 0
  private workTimer: ReturnType<typeof setInterval> | undefined
  private showTimer: ReturnType<typeof setTimeout> | undefined
  private queuedView: TerminalView | undefined
  private lastInterrupt = 0

  /**
   * @param actions - application-owned conversation actions.
   * @param completionDepth - maximum file-discovery depth.
   * @param completionFiles - maximum retained file suggestions.
   */
  constructor(actions: TerminalActions, completionDepth: number, completionFiles: number) {
    this.completion = new ProjectCompletion(process.cwd(), completionDepth, completionFiles, (message) => { this.status(message) })
    this.editor = new PromptEditor(this.tui, editorTheme, { paddingX: 0 })
    this.editor.setAutocompleteProvider(this.completion)
    this.editor.onSubmit = (text) => {
      this.editor.setText(text)
      if (this.pendingSubmission !== undefined || text.trim() === '') return
      this.pendingSubmission = text
      actions.send(text)
    }
    this.diagnostics = new Writable({ write: (chunk: Buffer, _encoding, done) => {
      this.status(terminalText(chunk.toString()).trim())
      done()
    } })
    this.interaction.addChild(this.editor)
    for (const child of [this.header, new Spacer(1), this.messages, this.live, this.interaction, this.notice, this.reading,
      new Text(color.dim('/ commands · @ files · ↑ history · Ctrl-C stop · Ctrl-Q exit'), 0, 0)]) this.tui.addChild(child)
    this.tui.addInputListener((data) => {
      if (matchesKey(data, 'ctrl+q') || (matchesKey(data, 'ctrl+d') && this.editor.getText() === '' && this.pending === undefined)) {
        actions.exit(); return { consume: true }
      }
      if (matchesKey(data, 'ctrl+c')) {
        const now = Date.now()
        if (this.working) actions.cancel()
        else if (this.pending === undefined && this.editor.getText() !== '') this.editor.setText('')
        else if (now - this.lastInterrupt < 2000) actions.exit()
        else { this.lastInterrupt = now; this.status('Press Ctrl-C again to exit') }
        return { consume: true }
      }
      if (this.pending !== undefined) return undefined
      if (matchesKey(data, 'ctrl+n')) { actions.create(); return { consume: true } }
      if (matchesKey(data, 'ctrl+r')) { actions.sessions(); return { consume: true } }
      if (matchesKey(data, 'ctrl+o')) { actions.tools(); return { consume: true } }
      if (matchesKey(data, 'ctrl+s')) {
        const text = this.editor.getExpandedText()
        if (text.trim() !== '' && this.pendingSubmission === undefined) { this.pendingSubmission = text; actions.send(text) }
        return { consume: true }
      }
      return undefined
    })
    try {
      globalThis.console = new Console({ stdout: this.diagnostics, stderr: this.diagnostics })
      this.tui.setClearOnShrink(false)
      this.tui.setFocus(this.editor)
      this.tui.start()
    } catch (error) {
      globalThis.console = this.previousConsole
      this.tui.stop()
      this.diagnostics.destroy()
      throw error
    }
  }

  /**
   * Display one conversation and initialize file completion from its directory.
   * @param id - selected Session identity.
   * @param url - shared Web application's authenticated URL.
   * @param directory - selected Session's directory.
   */
  session(id: string, url: string, directory: string): void {
    if (this.closed) return
    if (id === this.selected && directory === this.directory) return
    this.completion.setDirectory(directory)
    this.editor.setAutocompleteProvider(this.completion)
    this.selected = id
    this.directory = directory
    this.header.setText(`${color.bold.cyan('DeepSeek Harness')} · ${terminalText(id)}\n${terminalText(directory)}\nWeb: ${terminalText(new URL('/', url).origin)} · /web shows the sign-in link`)
    this.messages.clear()
    this.blocks.clear()
    this.live.clear()
    this.queuedView = undefined
    this.status('')
    this.tui.requestRender()
  }

  /** Report a diagnostic near the composer.
   * @param text - display text; control sequences are stripped. */
  status(text: string): void {
    if (this.closed) return
    this.notice.setText(text === '' ? '' : color.yellow(terminalText(text)))
    this.tui.requestRender()
  }

  /** Report a failed submission and keep its editor text available for retry.
   * @param message - actionable failure description. */
  failed(message: string): void { this.pendingSubmission = undefined; this.status(message) }

  /**
   * Reconcile immutable committed blocks and the current streaming answer.
   * @param view - bounded display projection from the Session follow stream.
   */
  show(view: TerminalView): void {
    if (this.closed) return
    if (this.showTimer !== undefined) { this.queuedView = view; return }
    this.render(view)
    this.showTimer = setTimeout(() => {
      this.showTimer = undefined
      const queued = this.queuedView
      this.queuedView = undefined
      if (queued !== undefined) this.show(queued)
    }, 40)
  }

  private elapsed(): void {
    const seconds = Math.floor((Date.now() - this.workStarted) / 1000)
    this.workLabel.setText(color.dim(`✻ Working… ${String(seconds)}s · Ctrl-C to stop`))
  }

  private render(view: TerminalView): void {
    if (view.working && !this.working) {
      this.workStarted = Date.now()
      this.workTimer = setInterval(() => { this.elapsed(); this.tui.requestRender() }, 1000)
    }
    if (!view.working && this.workTimer !== undefined) { clearInterval(this.workTimer); this.workTimer = undefined }
    this.working = view.working
    const children: Component[] = []
    const retained = new Set<string>()
    for (const entry of view.entries) {
      retained.add(entry.id)
      let block = this.blocks.get(entry.id)
      if (block?.entry !== entry) {
        block = { entry, component: new MessageBlock(entry) }
        this.blocks.set(entry.id, block)
      }
      children.push(block.component)
    }
    for (const seq of this.blocks.keys()) if (!retained.has(seq)) this.blocks.delete(seq)
    this.messages.children = children
    this.live.clear()
    if (view.live !== '' || view.working) {
      this.elapsed()
      this.live.addChild(this.workLabel)
      if (view.live !== '') {
        this.liveMarkdown.setText(view.live)
        this.live.addChild(this.liveMarkdown)
      }
    }
    this.tui.requestRender()
  }

  /** Update the compact model, usage, and balance status.
   * @param text - current projection readings. */
  metrics(text: string): void {
    if (this.closed) return
    this.reading.setText(color.dim(terminalText(text).replace('\nBalance:', ' · Balance:')))
    this.tui.requestRender()
  }

  /** Add an admitted prompt to input history and clear only that unchanged draft. */
  accepted(): void {
    if (this.closed) return
    const submitted = this.pendingSubmission ?? this.editor.getExpandedText()
    this.editor.addToHistory(submitted)
    if (this.editor.getExpandedText() === submitted) this.editor.setText('')
    this.pendingSubmission = undefined
    this.tui.requestRender()
  }

  /** Invalidate completion after a tool may have changed the project files. */
  refreshFiles(): void { this.completion.refresh() }

  /**
   * Ask an inline searchable question while preserving the main editor draft.
   * @param title - question and its supporting details.
   * @param choices - available labels in stable index order.
   * @param signal - application or interaction cancellation.
   * @returns original selected index, or undefined after dismissal.
   */
  choose(title: string, choices: readonly string[], signal: AbortSignal): Promise<number | undefined> {
    if (this.closed || signal.aborted) return Promise.resolve(undefined)
    this.pending?.()
    return new Promise((resolve) => {
      let settled = false
      const done = (value?: number): void => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', abort)
        this.pending = undefined
        this.restoreEditor()
        resolve(value)
      }
      const abort = (): void => { done() }
      this.pending = abort
      signal.addEventListener('abort', abort, { once: true })
      const menu = new InlineChoice(title, choices, this.terminal.rows, done, abort)
      this.interaction.clear()
      this.interaction.addChild(menu)
      this.tui.setFocus(menu)
      this.tui.requestRender()
    })
  }

  /**
   * Collect a multiline answer inline using the regular input key bindings.
   * @param title - foreground question.
   * @param signal - application or question cancellation.
   * @returns confirmed text, or undefined after dismissal.
   */
  ask(title: string, signal: AbortSignal): Promise<string | undefined> {
    if (this.closed || signal.aborted) return Promise.resolve(undefined)
    this.pending?.()
    return new Promise((resolve) => {
      let settled = false
      const done = (value?: string): void => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', abort)
        removeKeys()
        this.pending = undefined
        this.restoreEditor()
        resolve(value)
      }
      const abort = (): void => { done() }
      const input = new PromptEditor(this.tui, editorTheme, { paddingX: 0 })
      input.onSubmit = (value) => { if (value.trim() !== '') done(value) }
      const removeKeys = this.tui.addInputListener((data) => {
        if (matchesKey(data, 'escape')) { abort(); return { consume: true } }
        if (matchesKey(data, 'ctrl+s')) { done(input.getExpandedText()); return { consume: true } }
        return undefined
      })
      this.pending = abort
      signal.addEventListener('abort', abort, { once: true })
      this.interaction.clear()
      this.interaction.addChild(new Text(color.bold(terminalText(title)), 0, 1))
      this.interaction.addChild(input)
      this.tui.setFocus(input)
      this.tui.requestRender()
    })
  }

  private restoreEditor(): void {
    this.interaction.clear()
    this.interaction.addChild(this.editor)
    this.tui.setFocus(this.editor)
    if (!this.closed) this.tui.requestRender()
  }

  /** Restore console and terminal settings, cancel completion, and await file reads.
   * @returns after owned asynchronous completion requests have settled. */
  dispose(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    this.closed = true
    clearInterval(this.workTimer)
    clearTimeout(this.showTimer)
    globalThis.console = this.previousConsole
    this.pending?.()
    this.editor.setAutocompleteProvider(this.completion)
    this.tui.stop()
    this.diagnostics.destroy()
    this.closing = this.completion.dispose()
    return this.closing
  }
}
