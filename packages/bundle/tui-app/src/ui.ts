/** Main-screen terminal conversation, multiline editing, and foreground human input. */
import { DetailView } from './detail-view.ts'
import { TerminalLocale } from './locale.ts'
import { Console } from 'node:console'
import { Writable } from 'node:stream'
import {
  Box, Container, Editor, Input, Markdown, ProcessTerminal, SelectList, Spacer, Text, TuiMainScreen,
  matchesKey, truncateToWidth, fuzzyFilter, type Component, type Focusable, type SelectItem,
} from '@earendil-works/pi-tui'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { terminalCommands, ProjectCompletion } from './completion.ts'
import { renderActivity } from './activity.ts'
import { renderStatus, type StatusItem } from './status-bar.ts'
import { blockBackground, color, editorTheme, inputBackground, markdownTheme, selectTheme, separatorColor } from './theme.ts'
import type { Tints } from './appearance.ts'
import { terminalText, type TerminalActivity, type TerminalEntry, type TerminalView } from './transcript.ts'

/** Keep the user's pre-existing shell scrollback during a width-change redraw. */
class ScrollbackTerminal extends ProcessTerminal {
  override write(data: string): void { super.write(data.replaceAll('\x1b[3J', '')) }
}

class PromptEditor extends Editor {
  constructor(tui: TuiMainScreen, private readonly locale: TerminalLocale) { super(tui, editorTheme, { paddingX: 0 }) }
  override handleInput(data: string): void {
    if (matchesKey(data, 'enter') && this.isShowingAutocomplete()
      && terminalCommands.some(command => this.getText().trim() === `/${command.name}`)) super.handleInput('\x1b')
    super.handleInput(data)
  }

  protected override renderTopBorder(width: number): string {
    return color.dim(truncateToWidth(this.locale.text('› Message · Enter send · Shift+Enter new line'), width))
  }
  protected override renderBottomBorder(): string { return '' }
}

const TODO_MARK = { pending: '☐', in_progress: '◼', completed: '☒' } as const

/** Readings, key hints, and the current conversation below the input block. */
class StatusBar implements Component {
  readings: string[] = []
  right: StatusItem[] = []
  connected = true
  truncated = false
  queued: number | undefined
  layout: 'auto' | 'compact' | 'detailed' = 'auto'
  constructor(private readonly locale: TerminalLocale) {}
  render(width: number): string[] {
    const hint = color.dim(`${this.queued === undefined || this.queued === 0 ? '' : `${this.locale.text('Pending messages')}: ${this.queued} · /queue · `}${this.locale.text('/ commands · @ files · ↑ history · Ctrl-C stop · Ctrl-Q exit')}`)
    const connection = this.connected ? [] : [color.red(this.locale.text('Disconnected · /reconnect to retry'))]
    if (this.truncated) connection.push(color.yellow(truncateToWidth(
      this.locale.text('Recent history only · /history loads more · /export downloads the complete log'), width)))
    const rows = [...connection, ...renderStatus([...this.readings, hint], this.right, width, color.dim)]
    if (this.layout === 'detailed' || (this.layout === 'auto' && rows.length - connection.length <= this.readings.length + 1)) return rows
    return [...connection, truncateToWidth(this.readings[0] ?? '', width),
      truncateToWidth(this.right[1]?.text ?? '', width), truncateToWidth(hint, width)]
  }
  invalidate(): void {}
}

/** Fixed-height panel for the working turn; it renders nothing while idle. */
class ActivityPanel implements Component {
  working = false
  started = 0
  activity: TerminalActivity = { calls: 0, failed: 0 }

  constructor(private readonly locale: TerminalLocale) {}

  render(width: number): string[] {
    return this.working ? renderActivity(this.activity, Math.floor((Date.now() - this.started) / 1000), width, this.locale) : []
  }
  invalidate(): void {}
}

/** A mid-grey line across the terminal, used between blocks when they are not tinted. */
class Separator implements Component {
  private readonly paint = separatorColor()

  render(width: number): string[] { return [this.paint('─'.repeat(width))] }
  invalidate(): void {}
}

type Painter = ((text: string) => string) | undefined

/** Painters for the blocks of the conversation. */
interface Painters {
  readonly user: Painter
  readonly assistant: Painter
  readonly tools: Painter
}

class MessageBlock extends Container {
  constructor(entry: TerminalEntry, painters: Painters, separated: boolean, locale: TerminalLocale) {
    super()
    const painter = entry.kind === 'user' ? painters.user : entry.kind === 'assistant' ? painters.assistant
      : entry.kind === 'tools' || entry.kind === 'todo' ? painters.tools : undefined
    const body = new Box(painter === undefined ? 0 : 1, 0, painter)
    switch (entry.kind) {
      case 'user':
        body.addChild(new Text(color.bold.cyan(locale.text('You')), 0, 0))
        body.addChild(new Text(entry.text, 0, 0))
        break
      case 'assistant':
        body.addChild(new Text(color.bold(locale.text('Assistant')), 0, 0))
        body.addChild(new Markdown(entry.text, 0, 0, markdownTheme))
        break
      case 'tools': {
        const group = entry.group
        const summary = group === undefined || locale.language === 'en' ? entry.text : `${locale.text('{count} tool calls', { count: group.count })}${group.failed === 0 ? '' : ` · ${locale.text('{count} failed', { count: group.failed })}`}`
        const failures = group?.calls.filter(call => call.state === 'failed').map(call => call.title).join(', ') ?? ''
        body.addChild(new Text(`${(entry.group?.failed ?? 0) > 0 ? color.red('●') : color.green('●')} ${summary}${failures === '' ? '' : ` · ${failures}`} · /tools`, 0, 0))
        break
      }
      case 'todo':
        body.addChild(new Text(color.bold(locale.text('Todos')), 0, 0))
        for (const item of entry.todos ?? []) {
          const line = `  ${TODO_MARK[item.status]} ${item.content}`
          body.addChild(new Text(item.status === 'completed' ? color.dim.strikethrough(line)
            : item.status === 'in_progress' ? color.bold(line) : line, 0, 0))
        }
        break
      case 'status':
        body.addChild(new Text(color.dim(`── ${entry.text} ──`), 0, 0))
        if (entry.details !== undefined) body.addChild(new Text(color.red(entry.details), 0, 0))
        break
      default: assertNever(entry.kind)
    }
    this.addChild(body)
    if (separated) this.addChild(new Separator())
    else if (entry.kind !== 'tools') this.addChild(new Spacer(1))
  }
}

class InlineChoice extends Container implements Focusable {
  private readonly search: Input
  private list: SelectList
  private readonly items: SelectItem[]
  private query = ''
  private hasFocus = false
  get focused(): boolean { return this.hasFocus }
  set focused(value: boolean) { this.hasFocus = value; this.search.focused = value }

  constructor(title: string, choices: readonly string[], private readonly rows: number,
    private readonly select: (index: number) => void, private readonly cancel: () => void,
    private readonly locale: TerminalLocale, initial: number) {
    super()
    this.search = new Input({ prompt: locale.text('Find: '), placeholder: locale.text('type to filter · ↑↓ select · Enter confirm · Esc cancel') })
    this.items = choices.map((label, index) => ({ value: String(index), label: terminalText(label) }))
    this.list = this.makeList('')
    this.list.setSelectedIndex(initial)
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
    const list = new SelectList(fuzzyFilter(this.items, query, item => item.label), Math.max(3, Math.min(8, this.rows - 8)), { ...selectTheme, noMatch: () => color.yellow(this.locale.text('No matches')) })
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
  private readonly bar: StatusBar
  private readonly messages = new Container()
  private readonly live = new Container()
  private readonly liveMarkdown = new Markdown('', 0, 1, markdownTheme)
  private readonly panel: ActivityPanel
  private readonly interaction = new Container()
  private readonly notice = new Text('', 0, 0)
  private readonly completionNotice = new Text('', 0, 0)
  private readonly editor: PromptEditor
  private readonly editorBox: Box
  private readonly paint: Painter
  private readonly painters: Painters
  private readonly separated: boolean
  private readonly panelBox: Box
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
  private waiting: 'Waiting for approval' | 'Waiting for answer' | undefined
  private workTimer: ReturnType<typeof setInterval> | undefined
  private showTimer: ReturnType<typeof setTimeout> | undefined
  private queuedView: TerminalView | undefined
  private lastInterrupt = 0
  private readonly drafts = new Map<string, string>()
  private lastView: TerminalView | undefined

  /**
   * @param actions - application-owned conversation actions.
   * @param completionDepth - maximum file-discovery depth.
   * @param completionFiles - maximum retained file suggestions.
   * @param backgrounds - colors behind the input block and the conversation blocks.
   * @param locale - terminal language; omitted selects English.
   */
  constructor(actions: TerminalActions, completionDepth: number, completionFiles: number,
    backgrounds: Tints, readonly locale = new TerminalLocale()) {
    this.bar = new StatusBar(locale)
    this.panel = new ActivityPanel(locale)
    this.paint = inputBackground(backgrounds.input)
    this.painters = { user: blockBackground(backgrounds.user), assistant: blockBackground(backgrounds.assistant),
      tools: blockBackground(backgrounds.tools) }
    this.separated = this.painters.user === undefined && this.painters.assistant === undefined && this.painters.tools === undefined
    this.panelBox = new Box(this.painters.tools === undefined ? 0 : 1, 0, this.painters.tools)
    this.panelBox.addChild(this.panel)
    this.completion = new ProjectCompletion(process.cwd(), completionDepth, completionFiles, (message) => { this.status(message) },
      (message) => { this.completionNotice.setText(color.dim(message)); this.tui.requestRender() }, locale)
    this.editor = new PromptEditor(this.tui, this.locale)
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
    this.editorBox = this.inputBox(this.editor)
    this.interaction.addChild(this.editorBox)
    for (const child of [this.messages, this.live, this.interaction, this.completionNotice, this.notice, this.bar]) this.tui.addChild(child)
    this.tui.addInputListener((data) => {
      if (matchesKey(data, 'ctrl+q') || (matchesKey(data, 'ctrl+d') && this.editor.getText() === '' && this.pending === undefined)) {
        actions.exit(); return { consume: true }
      }
      if (matchesKey(data, 'ctrl+c')) {
        const now = Date.now()
        if (this.working) actions.cancel()
        else if (this.pending === undefined && this.editor.getText() !== '') this.editor.setText('')
        else if (now - this.lastInterrupt < 2000) actions.exit()
        else { this.lastInterrupt = now; this.status(this.locale.text('Press Ctrl-C again to exit')) }
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
    if (id !== this.selected) {
      if (this.selected !== undefined) {
        const draft = this.editor.getExpandedText()
        if (draft === '') this.drafts.delete(this.selected)
        else this.drafts.set(this.selected, draft)
      }
      this.editor.setText(this.drafts.get(id) ?? '')
      this.pendingSubmission = undefined
    }
    this.selected = id
    this.directory = directory
    this.bar.right = [
      { text: terminalText(`DeepSeek Harness · ${id}`), keep: 'start' },
      { text: terminalText(directory), keep: 'end' },
      { text: terminalText(`Web: ${new URL('/', url).origin} · /web for the sign-in link`), keep: 'start' },
    ]
    this.messages.clear()
    this.blocks.clear()
    this.live.clear()
    this.queuedView = undefined
    this.lastView = undefined
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

  private render(view: TerminalView): void {
    if (view.working && !this.working) {
      this.panel.started = Date.now()
      this.workTimer = setInterval(() => { this.tui.requestRender() }, 1000)
    }
    if (!view.working && this.workTimer !== undefined) { clearInterval(this.workTimer); this.workTimer = undefined }
    this.lastView = view
    this.bar.truncated = view.truncated === true
    this.working = view.working
    this.panel.working = view.working
    this.panel.activity = { ...view.activity, ...this.waiting === undefined ? {} : { phase: this.waiting } }
    const children: Component[] = []
    const retained = new Set<string>()
    for (const entry of view.entries) {
      retained.add(entry.id)
      let block = this.blocks.get(entry.id)
      if (block?.entry !== entry) {
        block = { entry, component: new MessageBlock(entry, this.painters, this.separated, this.locale) }
        this.blocks.set(entry.id, block)
      }
      if (!view.working || entry.kind !== 'tools') children.push(block.component)
    }
    for (const seq of this.blocks.keys()) if (!retained.has(seq)) this.blocks.delete(seq)
    this.messages.children = children
    this.live.clear()
    if (view.live !== '') {
      this.liveMarkdown.setText(view.live)
      this.live.addChild(this.liveMarkdown)
    }
    if (view.working) this.live.addChild(this.panelBox)
    this.tui.requestRender()
  }

  /** Update the compact model, usage, and balance status.
   * @param text - current projection readings. */
  metrics(text: string): void {
    if (this.closed) return
    this.bar.readings = terminalText(text).replace(`\n${this.locale.text('Balance')}:`, ` · ${this.locale.text('Balance')}:`).split('\n').map(line => color.dim(line))
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
   * @param initial - initially selected item; omission selects the first item.
   * @returns original selected index, or undefined after dismissal.
   */
  choose(title: string, choices: readonly string[], signal: AbortSignal, initial = 0): Promise<number | undefined> {
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
      const menu = new InlineChoice(title, choices, this.terminal.rows, done, abort, this.locale, initial)
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
   * @param initial - initial text; omitted starts with an empty answer.
   * @returns confirmed text, or undefined after dismissal.
   */
  ask(title: string, signal: AbortSignal, initial = ''): Promise<string | undefined> {
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
      const input = new PromptEditor(this.tui, this.locale)
      input.setText(initial)
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
      this.interaction.addChild(this.inputBox(input))
      this.tui.setFocus(input)
      this.tui.requestRender()
    })
  }

  /** Display the current pending-message count.
   * @param count - current editable human queue size; undefined hides an unavailable count. */
  queueCount(count: number | undefined): void { this.bar.queued = count; this.tui.requestRender() }

  /** Display the foreground interaction phase.
   * @param phase - foreground input phase, or undefined to resume the stream phase. */
  waitFor(phase: 'Waiting for approval' | 'Waiting for answer' | undefined): void {
    this.waiting = phase
    if (this.lastView !== undefined) this.render(this.lastView)
  }

  /** Keep transport loss visible beneath the composer.
   * @param connected - whether the current transport generation is established. */
  connection(connected: boolean): void { this.bar.connected = connected; this.tui.requestRender() }

  /** Re-render retained blocks after changing the instance language. */
  relocalize(): void {
    this.completion.setDirectory(this.directory ?? process.cwd())
    this.blocks.clear()
    if (this.lastView !== undefined) this.render(this.lastView)
    this.tui.requestRender()
  }

  /** Select the status row density.
   * @param layout - automatic width adaptation, compact, or detailed status rows. */
  layout(layout: 'auto' | 'compact' | 'detailed'): void { this.bar.layout = layout; this.tui.requestRender() }

  /** Read long text without losing the composer draft.
   * @param title - document heading.
   * @param text - document body.
   * @param signal - application or interaction cancellation.
   * @param markdown - true for prose rendering; omitted keeps plain text.
   * @returns after the reader closes or is cancelled. */
  view(title: string, text: string, signal: AbortSignal, markdown = false): Promise<void> {
    if (this.closed || signal.aborted) return Promise.resolve()
    this.pending?.()
    return new Promise((resolve) => {
      let settled = false
      const done = (): void => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', done)
        this.pending = undefined
        this.restoreEditor()
        resolve()
      }
      this.pending = done
      signal.addEventListener('abort', done, { once: true })
      const reader = new DetailView(title, text, () => this.terminal.rows, this.locale, done, markdown)
      this.interaction.clear()
      this.interaction.addChild(reader)
      this.tui.setFocus(reader)
      this.tui.requestRender()
    })
  }

  private inputBox(input: Component): Box {
    const box = new Box(0, 0, this.paint)
    box.addChild(input)
    return box
  }

  private restoreEditor(): void {
    this.interaction.clear()
    this.interaction.addChild(this.editorBox)
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
