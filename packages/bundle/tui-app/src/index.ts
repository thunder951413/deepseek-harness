/** Terminal application over the Web host's shared Session services. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-cmdline'
import type { TerminalView } from './transcript.ts'
import { TerminalUi } from './ui.ts'
import { TerminalControls } from './controls.ts'
import { terminalCommands } from './completion.ts'
import { SessionId, type HarnessPort, type PortAnswer, type PortQuestionRequest } from './port.ts'
import { WebRemotePort } from './web-remote.ts'
import { createRequire } from 'node:module'
import { observe } from './conversation.ts'
import { sessionsIn } from './history.ts'
import { chooseTints } from './appearance.ts'
import { queryBackground } from './background-query.ts'
import { startServer, type TerminalServer } from './server.ts'

/** Stable terminal plugin identity. */
export const name = 'tui'
/** Services owned by the shared Web composition. */
export const inject = ['tuiStartup']

/** Deployment-specific terminal history bounds. */
export interface Config {
  /** Existing conversation selected by the invocation. */
  session?: string
  /** Existing Host launch URL; omission starts an owned Web process. */
  connect?: string
  /** Stock profile used for the owned backend(). */
  backendProfile: string
  /** Listener port for an owned backend(). */
  port: number
  /** Maximum startup and compatibility-check interval. */
  startupTimeoutMs: number
  /** Maximum graceful subprocess shutdown interval. */
  shutdownTimeoutMs: number
  /** Maximum messages requested when opening a conversation. */
  historyMessages: number
  /** Maximum characters retained in the visible transcript. */
  transcriptCharacters: number
  /** Maximum directory depth searched by file completion. */
  completionDepth: number
  /** Maximum project file paths retained for completion. */
  completionFiles: number
  /** Reasoning effort applied to a new conversation when its model offers it; empty keeps the model's own default. */
  defaultReasoningEffort: string
  /** `auto` tints blocks from the terminal's reported background; `dark` and `light` assume a typical one. */
  appearance: 'auto' | 'dark' | 'light'
  /** `#rrggbb` color behind the input block; empty uses the tint derived from the background. */
  inputBackground: string
  /** `#rrggbb` tint behind your messages; empty uses the derived tint. Needs a 256-color terminal. */
  userBackground: string
  /** `#rrggbb` tint behind the assistant's answers; empty uses the derived tint. Needs a 256-color terminal. */
  assistantBackground: string
  /** `#rrggbb` tint behind tool activity and task lists; empty uses the derived tint. Needs a 256-color terminal. */
  toolBackground: string
}

/** Terminal history limits, configurable through profile patches. */
export const Config: z<Config> = z.object({
  session: z.string(),
  connect: z.string(),
  backendProfile: z.string().default('web'),
  port: z.natural().max(65535).default(0),
  startupTimeoutMs: z.natural().min(1).default(20000),
  shutdownTimeoutMs: z.natural().min(1).default(5000),
  historyMessages: z.natural().min(1).default(200),
  transcriptCharacters: z.natural().min(1).default(200000),
  completionDepth: z.natural().min(1).default(8),
  completionFiles: z.natural().min(1).default(10000),
  defaultReasoningEffort: z.string().default('high'),
  appearance: z.union(['auto', 'dark', 'light'] as const).default('auto'),
  inputBackground: z.string().pattern(/^(?:#[0-9a-fA-F]{6})?$/u).default(''),
  userBackground: z.string().pattern(/^(?:#[0-9a-fA-F]{6})?$/u).default(''),
  assistantBackground: z.string().pattern(/^(?:#[0-9a-fA-F]{6})?$/u).default(''),
  toolBackground: z.string().pattern(/^(?:#[0-9a-fA-F]{6})?$/u).default(''),
})

/**
 * Start the terminal and its independently owned or connected Web backend().
 * @param ctx - application context owning the shared Session controller.
 * @param config - validated display bounds.
 */
export function apply(ctx: Context, config: Config): void {
  const manifest: unknown = createRequire(import.meta.url)('../package.json')
  const version = typeof manifest === 'object' && manifest !== null && 'version' in manifest && typeof manifest.version === 'string'
    ? manifest.version : ''
  if (version === '') throw new Error('tui package version is missing')
  const ready = ctx.get('appReady')
  const exit = ctx.get('appExit')
  if (ready === undefined || exit === undefined) throw new Error('tui requires the dsh profile launcher')
  const lifetime = new AbortController()
  const tasks = new Set<Promise<void>>()
  let transcript: TerminalView = { entries: [], live: '', working: false, activity: { calls: 0, failed: 0 } }
  let connection: HarnessPort | undefined
  const backend = (): HarnessPort => {
    if (connection === undefined) throw new Error('Harness is still connecting; wait for the conversation to open')
    return connection
  }
  let server: TerminalServer | undefined
  let ui: TerminalUi | undefined
  let controls: TerminalControls | undefined
  let selected: SessionId | undefined
  let directory = process.cwd()
  let follower: AbortController | undefined
  let following: Promise<void> | undefined
  let busy = false
  let interaction = Promise.resolve()

  const report = (error: unknown): void => {
    if (lifetime.signal.aborted) return
    ui?.failed(`Error: ${error instanceof Error ? error.message : String(error)}\nCtrl-R history · Ctrl-N new · Ctrl-Q quit`)
  }
  const run = (action: () => Promise<void>): void => {
    const task = action().catch(report)
    tasks.add(task)
    void task.finally(() => { tasks.delete(task) })
  }
  const serialize = (action: () => Promise<void>): void => {
    if (busy || lifetime.signal.aborted) return
    busy = true
    run(async () => { try { await action() } finally { busy = false } })
  }
  const title = (): void => {
    if (selected !== undefined) ui?.session(selected, backend().url, directory)
  }
  const select = async (id: SessionId): Promise<void> => {
    follower?.abort()
    await following
    if (lifetime.signal.aborted) return
    selected = id
    transcript = { entries: [], live: '', working: false, activity: { calls: 0, failed: 0 } }
    ui?.status('Loading conversation…')
    await controls?.select(id)
    lifetime.signal.throwIfAborted()
    follower = new AbortController()
    const signal = AbortSignal.any([follower.signal, lifetime.signal])
    following = (async () => {
      for await (const frame of observe(backend(), id, config.historyMessages, config.transcriptCharacters, directory, signal)) {
        if (signal.aborted) return
        if (frame.directory !== undefined) {
          directory = frame.directory
          title()
          ui?.status('')
        }
        if (frame.turnEnded) {
          ui?.refreshFiles()
          run(async () => { await controls?.refreshBalance() })
        }
        transcript = frame.view
        ui?.show(frame.view)
      }
    })().catch((error: unknown) => { if (!signal.aborted) report(error) })
  }
  const create = async (): Promise<void> => {
    const id = await backend().createSession(process.cwd())
    lifetime.signal.throwIfAborted()
    await select(id)
    await controls?.useDefaultEffort(id, config.defaultReasoningEffort)
  }
  const pick = async (): Promise<void> => {
    const here = process.cwd()
    const sessions = await sessionsIn(here, await backend().listSessions(lifetime.signal))
    const index = await ui?.choose(`Conversations · choose one to resume\n\nIn ${here}; /resume <id> opens one from another directory.`, [
      '+ New conversation', ...sessions.map(item => `${item.running ? '▶ ' : ''}${item.title ?? 'Untitled'} · ${item.id}`),
    ], lifetime.signal)
    if (index === 0) await create()
    else if (index !== undefined) {
      const session = sessions[index - 1]
      if (session !== undefined) await select(session.id)
    }
  }
  const inspectTools = async (): Promise<void> => {
    const calls = transcript.entries.flatMap(entry => entry.group?.calls ?? []).toReversed()
    const index = await ui?.choose('Tool activity · choose an item to expand', calls.length === 0 ? ['No tool activity · Close']
      : calls.map(call => `${call.state === 'failed' ? '✗' : call.state === 'running' ? '…' : '✓'} ${call.title}`), lifetime.signal)
    const call = index === undefined ? undefined : calls[index]
    if (call !== undefined) await ui?.choose(`${call.title}\n\n${call.details === '' ? 'No text output' : call.details}`, ['Close'], lifetime.signal)
  }
  const send = async (text: string): Promise<void> => {
    if (text.trim() === '') return
    if (selected === undefined) await create()
    if (selected === undefined || lifetime.signal.aborted) return
    const [command, argument] = text.trim().split(/\s+/u)
    if (['/new', '/clear', '/resume', '/tools', '/help', '/exit', '/web'].includes(command ?? '')) {
      ui?.accepted()
      if (command === '/new' || command === '/clear') await create()
      else if (command === '/web') await ui?.choose(`Browser sign-in link\n\n${backend().url}\n\nOpen it in a browser to configure providers and credentials. Treat it like a password.`, ['Close'], lifetime.signal)
      else if (command === '/resume') {
        if (argument === undefined) await pick()
        else await select(SessionId(argument))
      } else if (command === '/tools') await inspectTools()
      else if (command === '/help') await ui?.choose(
        `Commands\n\n${terminalCommands.map(item => `/${item.name} — ${item.description ?? ''}`).join('\n')}\n\nEnter send · Shift+Enter new line · ↑↓ edit/history\nCtrl-N new · Ctrl-R resume · Ctrl-O tools · Ctrl-C stop (twice to exit) · Ctrl-Q exit\n@ inserts a project file path; the model can read it with its file tools.`, ['Close'], lifetime.signal)
      else exit(0)
      return
    }
    if (await enqueue(async () => await controls?.command(text) ?? false)) { title(); return }
    await backend().prompt(selected, text, lifetime.signal)
    ui?.accepted()
    title()
  }
  const cancel = (): void => {
    if (selected === undefined) return
    const sessionId = selected
    run(async () => { await backend().cancel(sessionId) })
  }
  const enqueue = <T>(action: () => Promise<T>): Promise<T> => {
    const result = interaction.then(action)
    interaction = result.then(() => {}, () => {})
    return result
  }
  const answer = async (request: PortQuestionRequest): Promise<{ answers: PortAnswer[] }> => {
    const view = ui
    if (view === undefined) throw new Error('Terminal is unavailable')
    const signal = AbortSignal.any([lifetime.signal, ...request.signal === undefined ? [] : [request.signal]])
    const claim = new AbortController()
    const claimSignal = AbortSignal.any([claim.signal, signal])
    const sessionId = request.sessionId
    const wait = request.wait
    const claimed = wait?.timed === true
      ? (async () => {
        for await (const _frame of backend().holdQuestion(sessionId, wait.callId, claimSignal)) {
          // Holding the iterator keeps the foreground question open until input settles.
        }
      })()
      : Promise.resolve()
    try {
      const answers: PortAnswer[] = []
      for (const question of request.questions) {
        signal.throwIfAborted()
        const heading = `${question.question}\n\n${question.detail ?? ''}`
        const options = question.options ?? []
        const selectedOptions: string[] = []
        let custom: string | undefined
        if (options.length > 0) {
          for (;;) {
            const index = await view.choose(heading, [
              ...options.map(option => [
                selectedOptions.includes(option.label) ? '[✓] ' : '', option.label,
                option.description === undefined ? '' : ` — ${option.description}`,
              ].join('')),
              'Type an answer…', ...question.multiSelect === true ? ['Done'] : [],
            ], signal)
            if (index === undefined) throw new Error('Question dismissed; stop the turn or answer in the Web interface')
            if (index === options.length) { custom = await view.ask(heading, signal); break }
            if (index > options.length) break
            const option = options[index]
            if (option === undefined) throw new Error('Terminal returned an invalid option')
            const label = option.label
            const old = selectedOptions.indexOf(label)
            if (old < 0) selectedOptions.push(label)
            else selectedOptions.splice(old, 1)
            if (question.multiSelect !== true) break
          }
        } else custom = await view.ask(heading, signal)
        signal.throwIfAborted()
        if (selectedOptions.length === 0 && custom === undefined) throw new Error('Question dismissed')
        answers.push({ id: question.id, selected: selectedOptions, ...custom === undefined ? {} : { custom } })
      }
      return { answers }
    } finally {
      claim.abort()
      await claimed
    }
  }
  const attachInteractions = (): void => {
    backend().onApproval(async (request) => {
      const view = ui
      if (view === undefined || request.sessionId !== selected || lifetime.signal.aborted) return undefined
      return enqueue(async () => {
        const signal = AbortSignal.any([lifetime.signal, ...request.signal === undefined ? [] : [request.signal]])
        const operation = request.callId === undefined ? undefined : await backend().readToolCall(request.sessionId, request.callId, signal)
        if (operation === undefined) {
          view.status(`Approval for ${request.toolName} needs the Web interface: its arguments are not available here.`)
          return undefined
        }
        const choice = await view.choose(
          `Allow ${request.toolName}?\n\n${operation}\n\n${request.reason ?? ''}`, ['Reject', 'Allow once'], signal,
        )
        return signal.aborted ? 'cancelled' : choice === 1 ? 'allowed-once' : 'rejected'
      })
    })
    backend().onQuestion(async (request) => {
      if (ui === undefined || request.sessionId !== selected || lifetime.signal.aborted) return undefined
      return enqueue(() => answer(request))
    })
  }
  ctx.effect(() => ready.onReady(() => {
    run(async () => {
      try {
        const detected = config.appearance === 'auto' && process.env.NO_COLOR === undefined
          ? await queryBackground(process.stdin, process.stdout) : undefined
        const tints = chooseTints({ appearance: config.appearance, detected, env: process.env, overrides: {
          input: config.inputBackground, user: config.userBackground, assistant: config.assistantBackground, tools: config.toolBackground,
        } })
        ui = new TerminalUi({
          send: (text) => { serialize(() => send(text)) },
          sessions: () => { serialize(pick) }, create: () => { serialize(create) }, cancel,
          tools: () => { serialize(inspectTools) }, exit: () => { exit(0) },
        }, config.completionDepth, config.completionFiles, tints)
        const startupSignal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(config.startupTimeoutMs)])
        const url = config.connect ?? (server = await startServer(config.backendProfile, config.port, config.startupTimeoutMs,
          config.shutdownTimeoutMs, lifetime.signal, text => ui?.status(text))).url
        connection = await WebRemotePort.connect(url, startupSignal)
        attachInteractions()
        controls = new TerminalControls(backend(), ui, lifetime.signal, version)
        const activeControls = controls
        run(() => activeControls.watchSessions())
        run(() => activeControls.watchAccount())
        run(() => activeControls.loadModels())
        title()
        serialize(async () => {
          if (config.session !== undefined) await select(SessionId(config.session))
          else await create()
        })
      } catch (error) {
        await ui?.dispose()
        if (!lifetime.signal.aborted) { console.error(error); exit(1) }
      }
    })
  }), 'terminal startup')
  ctx.effect(() => async () => {
    lifetime.abort()
    follower?.abort()
    await ui?.dispose()
    await connection?.dispose()
    await server?.close()
    await Promise.allSettled([...tasks, interaction, ...following === undefined ? [] : [following]])
  }, 'terminal shutdown')
}
