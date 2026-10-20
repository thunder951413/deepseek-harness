/** Terminal application over the Web host's shared Session services. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-cmdline'
import { TerminalLocale } from './locale.ts'
import { askExportPath, browseTools, exportArchive, manageQueue } from './actions.ts'
import type { TerminalView } from './transcript.ts'
import { TerminalUi } from './ui.ts'
import { TerminalControls } from './controls.ts'
import { terminalCommands } from './completion.ts'
import {
  ConversationId, type HarnessPort, type HostCommand, type PortAnswer, type PortQuestionRequest, type SkillSummary,
} from './port.ts'
import { WebRemotePort } from './web-remote.ts'
import { createRequire } from 'node:module'
import { observe } from './conversation.ts'
import { canonical, sessionsIn } from './history.ts'
import { relativeAge } from './welcome.ts'
import { readUpdateRecord, startUpdate, updateDue } from './auto-update.ts'
import { chooseTints } from './appearance.ts'
import { queryBackground } from './background-query.ts'
import { startServer, type TerminalServer } from './server.ts'
import { listenHost } from './listen.ts'
import { networkInterfaces } from 'node:os'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Harness-home path resolver provided by the dsh launcher. */
    dshHomePath?: (...segments: string[]) => string
  }
}

/** Stable terminal plugin identity. */
export const name = 'tui'
/** Services owned by the shared Web composition. */
export const inject = ['tuiStartup']

/** Deployment-specific terminal history bounds. */
export interface Config {
  /** Existing conversation selected by the invocation. */
  session?: string
  /** Interface language. */
  language: 'en' | 'zh'
  /** Status density. */
  statusLayout: 'auto' | 'compact' | 'detailed'
  /** Existing Host launch URL; omission starts an owned Web process. */
  connect?: string
  /** Stock profile used for the owned backend(). */
  backendProfile: string
  /** Listener port for an owned backend(). */
  port: number
  /** Listener address for an owned backend: `lan` (a local network interface), `loopback`, or one interface address. */
  host: string
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
  language: z.union(['en', 'zh'] as const).default('en'),
  statusLayout: z.union(['auto', 'compact', 'detailed'] as const).default('auto'),
  connect: z.string(),
  backendProfile: z.string().default('web'),
  port: z.natural().max(65535).default(0),
  host: z.string().default('lan'),
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
  const locale = new TerminalLocale(config.language)
  const t = locale.text.bind(locale)
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
  let selected: ConversationId | undefined
  let directory = process.cwd()
  let follower: AbortController | undefined
  let following: Promise<void> | undefined
  let operations = Promise.resolve()
  let liveControls: AbortController | undefined
  let stopConnection: (() => void) | undefined
  let connected = true
  let historyMessages = config.historyMessages
  let selection = 0
  let viewed = false
  /** Work mode chosen with /mode in this terminal; later conversations start in it. */
  let preferredMode: string | undefined
  const prompted = new Set<ConversationId>()
  let skills: readonly SkillSummary[] = []
  let hostCommands: readonly HostCommand[] = []
  // `/` offers the Harness's commands and then its skills beside the terminal's own commands.
  const offerCommands = (): void => {
    ui?.commands([...hostCommands, ...skills.map(skill => ({ name: skill.name,
      description: `${t('Skill')}${skill.description === '' ? '' : ` · ${skill.description}`}` }))])
  }
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
    const next = operations.then(async () => { if (!lifetime.signal.aborted) await action() }).catch(report)
    operations = next
  }
  // A held or repeated shortcut queues its picker once, not once per key press.
  const pending = new Set<string>()
  const serializeOnce = (key: string, action: () => Promise<void>): void => {
    if (pending.has(key)) return
    pending.add(key)
    serialize(async () => { try { await action() } finally { pending.delete(key) } })
  }
  const title = (): void => {
    if (selected !== undefined) ui?.session(selected, directory)
  }
  const select = async (id: ConversationId): Promise<void> => {
    follower?.abort()
    await following
    if (lifetime.signal.aborted) return
    const current = ++selection
    if (id !== selected) historyMessages = config.historyMessages
    selected = id
    viewed = false
    transcript = { entries: [], live: '', working: false, activity: { calls: 0, failed: 0 } }
    ui?.status(t('Loading conversation…'))
    await controls?.select(id)
    run(async () => {
      let catalog: SkillSummary[]
      try {
        catalog = await backend().skills(id, lifetime.signal)
      } catch (_error) {
        // The list only decorates the banner and /help; a Harness without a skill catalog, or a failed read, leaves it hidden.
        return
      }
      if (selected !== id) return
      skills = catalog
      ui?.banner({ skills: catalog })
      offerCommands()
    })
    run(async () => {
      let listed: HostCommand[]
      try {
        listed = await backend().hostCommands(id)
      } catch (_error) {
        // Without the Host's command list, lines that start with `/` keep going to the model as messages.
        return
      }
      if (selected !== id) return
      hostCommands = listed
      offerCommands()
    })
    lifetime.signal.throwIfAborted()
    if (current !== selection) return
    follower = new AbortController()
    const signal = AbortSignal.any([follower.signal, lifetime.signal])
    following = (async () => {
      for await (const frame of observe(backend(), id, historyMessages, config.transcriptCharacters, directory, signal)) {
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
        viewed = true
        ui?.show(frame.view)
      }
    })().catch((error: unknown) => { if (!signal.aborted) report(error) })
  }
  // A new conversation reuses this directory's newest empty one, as the Web client does, so starting the terminal
  // or pressing /new repeatedly leaves at most one empty conversation per directory.
  const empty = (): boolean =>
    selected !== undefined && viewed && transcript.entries.length === 0 && !transcript.working && !prompted.has(selected)
  const create = async (): Promise<void> => {
    if (empty()) {
      ui?.status(t('This conversation is still empty; type a message to start it'))
      return
    }
    // The Host reuses a Session only when its recorded directory equals the Workspace path exactly.
    const workspacePath = await canonical(process.cwd())
    const reusable = (await backend().listSessions(lifetime.signal))
      .find(item => item.blank && !item.running && item.id !== selected && item.cwd === workspacePath)
    let id: ConversationId
    try {
      id = await backend().createSession(process.cwd(), reusable?.id, preferredMode)
    } catch (error) {
      // Reuse only saves an empty conversation; when the Host refuses the named one, a new conversation still starts.
      if (reusable === undefined) throw error
      id = await backend().createSession(process.cwd(), undefined, preferredMode)
    }
    lifetime.signal.throwIfAborted()
    await select(id)
    await controls?.useDefaultEffort(id, config.defaultReasoningEffort)
  }
  const search = async (query?: string): Promise<void> => {
    const value = query ?? await ui?.ask(t('Search conversation content'), lifetime.signal)
    if (value === undefined || value.trim() === '') return
    const result = await backend().search(value, lifetime.signal)
    if (result.items.length === 0) { ui?.status(t('No matches')); return }
    const index = await ui?.choose(`${t('Search results')}${result.hasMore ? ` · ${t('More matches exist; narrow the search.')}` : ''}`,
      result.items.map(item => `${item.id} · ${item.snippet}`), lifetime.signal)
    const match = index === undefined ? undefined : result.items[index]
    if (match !== undefined) await select(match.id)
  }
  // A conversation keeps its mode after its first message, so choosing another mode then starts a new conversation.
  const chooseMode = async (): Promise<void> => {
    const id = selected
    if (ui === undefined || id === undefined || controls === undefined) return
    const roster = await controls.loadModes()
    if (roster.length === 0) { ui.status(t('This Harness offers no work modes')); return }
    const current = controls.currentMode()?.id
    const index = await ui.choose(t('Work mode'), roster.map(mode => ({
      label: `${mode.id === current ? '● ' : '  '}${mode.name}`,
      description: mode.broken === undefined ? `${mode.description}${mode.isDefault ? ` · ${t('default')}` : ''}`
        : t('Unavailable: {reason}', { reason: mode.broken }),
      search: `${mode.name} ${mode.id}`,
    })), lifetime.signal, Math.max(0, roster.findIndex(mode => mode.id === current)))
    const mode = index === undefined ? undefined : roster[index]
    if (mode === undefined || mode.id === current) return
    if (mode.broken !== undefined) { ui.status(t('{mode} is unavailable: {reason}', { mode: mode.name, reason: mode.broken })); return }
    preferredMode = mode.id
    if (empty()) {
      await backend().selectMode(id, mode.id)
      ui.status(t('Work mode: {mode}', { mode: mode.name }))
      return
    }
    await create()
    ui.status(t('Started a new conversation in {mode}; a conversation keeps its mode after its first message', { mode: mode.name }))
  }
  // The Host reports a command's result as text; a short one fits the status line, a long one opens the reader.
  const runHostCommand = async (line: string): Promise<void> => {
    const id = selected
    if (ui === undefined || id === undefined) return
    const outcome = await backend().runCommand(id, line)
    const text = outcome.text.trim()
    if (!outcome.matched) ui.status(t('The Harness no longer offers {command}', { command: line.split(/\s+/u)[0] ?? line }))
    else if (outcome.failed) ui.status(text === '' ? t('{command} failed', { command: line.split(/\s+/u)[0] ?? line }) : text)
    else if (text.includes('\n')) await ui.view(line, text, lifetime.signal, true)
    else ui.status(text === '' ? t('{command} done', { command: line.split(/\s+/u)[0] ?? line }) : text)
  }
  const choosePermission = async (): Promise<void> => {
    if (ui === undefined) return
    const presets = await backend().permissionPresets()
    const current = controls?.permission()
    const index = await ui.choose(t('Permission'), presets.map(preset => ({
      label: `${preset.id === current ? '● ' : '  '}${preset.name}`, description: preset.description, search: `${preset.name} ${preset.id}`,
    })), lifetime.signal, Math.max(0, presets.findIndex(preset => preset.id === current)))
    const preset = index === undefined ? undefined : presets[index]
    if (preset === undefined || preset.id === current) return
    await runHostCommand(`/permission ${preset.id}`)
  }
  const archivedSessions = async (): Promise<ReadonlySet<ConversationId>> => {
    try {
      return await backend().archivedSessions(lifetime.signal)
    } catch (_error) {
      // The archive only filters history lists; without it, archived conversations are listed too.
      return new Set()
    }
  }
  const pick = async (): Promise<void> => {
    let all = false
    for (;;) {
      const [available, archived] = await Promise.all([backend().listSessions(lifetime.signal), archivedSessions()])
      const visible = available.filter(item => (!item.blank && !archived.has(item.id)) || item.id === selected)
      const sessions = all ? visible : await sessionsIn(process.cwd(), visible)
      const index = await ui?.choose(`${t('Conversations')} · ${t(all ? 'All projects' : 'Current project')}`, [
        t('+ New conversation'), ...sessions.map((item) => {
          const label = `${item.running ? '▶ ' : ''}${item.title ?? t('Untitled')}`
          const where = all && item.cwd !== undefined ? ` · ${item.cwd}` : ''
          return { label, description: `${relativeAge(item.updatedAt, locale.language)}${where} · ${item.id}`, search: `${label} ${item.id}` }
        }),
        t(all ? 'Current project' : 'All projects'), t('Search conversation content'),
      ], lifetime.signal)
      if (index === undefined) return
      if (index === sessions.length + 1) { all = !all; continue }
      if (index === sessions.length + 2) await search()
      else if (index === 0) await create()
      else { const session = sessions[index - 1]; if (session !== undefined) await select(session.id) }
      return
    }
  }
  const chooseSkill = async (): Promise<void> => {
    const id = selected
    if (ui === undefined || id === undefined) return
    const catalog = await backend().skills(id, lifetime.signal)
    if (selected !== id) return
    skills = catalog
    ui.banner({ skills: catalog })
    offerCommands()
    if (catalog.length === 0) { ui.status(t('No skills are available for this conversation')); return }
    const index = await ui.choose(t('Skills'), catalog.map(skill => ({ label: skill.name, description: skill.description })), lifetime.signal)
    const skill = index === undefined ? undefined : catalog[index]
    if (skill !== undefined) ui.compose(`/${skill.name} `)
  }
  const inspectTools = async (): Promise<void> => { if (ui !== undefined) await browseTools(ui, transcript, lifetime.signal) }
  const send = async (text: string): Promise<void> => {
    if (text.trim() === '') return
    if (selected === undefined) await create()
    if (selected === undefined || lifetime.signal.aborted) return
    const command = text.trim().split(/\s+/u)[0]
    const argument = text.trim().slice(command?.length ?? 0).trim() || undefined
    if (command !== undefined && ['/queue', '/steer', '/search', '/rename', '/fork', '/export', '/language', '/layout', '/history', '/reconnect'].includes(command)) {
      if (ui === undefined) return
      const id = selected
      if (command === '/steer') {
        const instruction = argument ?? await ui.ask(t('Steer now'), lifetime.signal)
        if (instruction !== undefined) { prompted.add(id); await backend().prompt(id, instruction, lifetime.signal, 'steer'); ui.accepted(); ui.status(t('Instruction accepted for the next model step')) }
        else ui.failed('')
        return
      }
      ui.accepted()
      if (command === '/queue') await manageQueue(ui, backend(), id, lifetime.signal)
      else if (command === '/search') await search(argument)
      else if (command === '/rename') {
        const title = argument ?? await ui.ask(t('Rename conversation'), lifetime.signal)
        if (title !== undefined) { await backend().rename(id, title); ui.status(t('Conversation renamed')) }
      } else if (command === '/fork') {
        if (await ui.choose(t('Fork from the latest completed turn?'), [t('Cancel'), t('Fork')], lifetime.signal) === 1) await select(await backend().fork(id))
      } else if (command === '/export') {
        const path = await askExportPath(ui, id, lifetime.signal)
        if (path !== undefined) {
          ui.status(t('Exporting…'))
          // Detached so a long download does not block sending or recovery; the file is removed if it fails.
          run(async () => { await exportArchive(backend(), id, path, lifetime.signal); ui?.status(t('Saved to {path}', { path })) })
        }
      }
      else if (command === '/language') {
        const choice = await ui.choose(t('Language'), ['English', '简体中文'], lifetime.signal, locale.language === 'en' ? 0 : 1)
        if (choice !== undefined) { locale.language = choice === 0 ? 'en' : 'zh'; ui.relocalize(); await controls?.select(id) }
      } else if (command === '/layout') {
        const choice = await ui.choose(t('Layout'), [t('Automatic'), t('Compact'), t('Detailed')], lifetime.signal)
        if (choice !== undefined) ui.layout(choice === 0 ? 'auto' : choice === 1 ? 'compact' : 'detailed')
      } else if (command === '/history') { historyMessages += config.historyMessages; await select(id) }
      else { ui.status(t('Reconnecting…')); backend().reconnect() }
      return
    }
    if (['/new', '/clear', '/resume', '/tools', '/skills', '/mode', '/help', '/exit', '/web'].includes(command ?? '')) {
      ui?.accepted()
      if (command === '/new' || command === '/clear') await create()
      else if (command === '/web') {
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(backend().url).hostname)
        await ui?.view(t('Browser sign-in link'), `${backend().url}\n\n${t('Open it in a browser to configure providers and credentials. Treat it like a password.')}${
          local ? '' : `\n${t('Other computers on this network can open it too, and whoever has it can run commands on this computer.')}`}`, lifetime.signal)
      }
      else if (command === '/resume') {
        if (argument === undefined) await pick()
        else await select(ConversationId(argument))
      } else if (command === '/tools') await inspectTools()
      else if (command === '/skills') await chooseSkill()
      else if (command === '/mode') await chooseMode()
      else if (command === '/help') await ui?.view(t('Commands'),
        `${t('Enter send · Shift+Enter new line · ↑↓ edit/history')}\n${t('Ctrl-N new · Ctrl-R resume · Ctrl-O tools · Ctrl-C stop (twice to exit) · Ctrl-Q exit')}\n${t('@ inserts a project file path; the model can read it with its file tools.')}\n\n${terminalCommands.map(item => `/${item.name} — ${locale.description(item.description)}`).join('\n')}${hostCommands.length === 0 ? '' : `\n\n${t('Harness commands')}\n\n${hostCommands.map(item => `/${item.name}${item.description === '' ? '' : ` — ${item.description}`}`).join('\n')}`}${skills.length === 0 ? '' : `\n\n${t('Skills')}\n\n${skills.map(skill => `/${skill.name}${skill.description === '' ? '' : ` — ${skill.description}`}`).join('\n')}`}`, lifetime.signal)
      else exit(0)
      return
    }
    if (await enqueue(async () => await controls?.command(text) ?? false)) { title(); return }
    const hostName = command?.startsWith('/') === true ? command.slice(1) : undefined
    if (hostName !== undefined && hostCommands.some(item => item.name === hostName) && ui !== undefined) {
      ui.accepted()
      if (hostName === 'permission' && argument === undefined) await choosePermission()
      else await runHostCommand(text.trim())
      return
    }
    const queued = transcript.working
    prompted.add(selected)
    await backend().prompt(selected, text, lifetime.signal)
    ui?.accepted()
    title()
    if (queued) ui?.status(t('Message accepted for the next turn · /queue to manage'))
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
    const signal = AbortSignal.any([lifetime.signal, ...follower === undefined ? [] : [follower.signal],
      ...request.signal === undefined ? [] : [request.signal]])
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
              t('Type an answer…'), ...question.multiSelect === true ? [t('Done')] : [],
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
      const selectionSignal = follower?.signal
      return enqueue(async () => {
        if (request.sessionId !== selected || selectionSignal?.aborted === true) return undefined
        const signal = AbortSignal.any([lifetime.signal, ...follower === undefined ? [] : [follower.signal],
          ...request.signal === undefined ? [] : [request.signal]])
        const operation = request.callId === undefined ? undefined : await backend().readToolCall(request.sessionId, request.callId, signal)
        if (operation === undefined) {
          view.status(`Approval for ${request.toolName} needs the Web interface: its arguments are not available here.`)
          return undefined
        }
        view.waitFor('Waiting for approval')
        await view.view(t('Review operation'), `${operation}\n\n${request.reason ?? ''}`, signal)
        for (;;) {
          const choice = await view.choose(t('Allow {tool}?', { tool: request.toolName }), [t('Reject'), t('Allow once'), t('Review operation')], signal)
          if (choice === 2) { await view.view(t('Review operation'), `${operation}\n\n${request.reason ?? ''}`, signal); continue }
          view.waitFor(undefined)
          return signal.aborted ? 'cancelled' : choice === 1 ? 'allowed-once' : 'rejected'
        }
      })
    })
    backend().onQuestion(async (request) => {
      if (ui === undefined || request.sessionId !== selected || lifetime.signal.aborted) return undefined
      const selectionSignal = follower?.signal
      return enqueue(async () => {
        if (request.sessionId !== selected || selectionSignal?.aborted === true) return undefined
        ui?.waitFor('Waiting for answer')
        try { return await answer(request) } finally { ui?.waitFor(undefined) }
      })
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
          sessions: () => { serializeOnce('sessions', pick) }, create: () => { serializeOnce('create', create) }, cancel,
          tools: () => { serializeOnce('tools', inspectTools) }, exit: () => { exit(0) },
        }, config.completionDepth, config.completionFiles, tints, locale)
        ui.layout(config.statusLayout)
        ui.banner({ version })
        const startupSignal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(config.startupTimeoutMs)])
        const host = listenHost(config.host, networkInterfaces())
        if (config.connect === undefined && config.host === 'lan' && host === undefined) {
          ui.status(t('No local network address was found; the Web service accepts connections from this computer only'))
        }
        const url = config.connect ?? (server = await startServer(config.backendProfile, config.port, host, config.startupTimeoutMs,
          config.shutdownTimeoutMs, lifetime.signal, text => ui?.status(text))).url
        connection = await WebRemotePort.connect(url, startupSignal)
        attachInteractions()
        const startControls = (): void => {
          if (ui === undefined) return
          liveControls?.abort()
          liveControls = new AbortController()
          const signal = AbortSignal.any([lifetime.signal, liveControls.signal])
          controls = new TerminalControls(backend(), ui, signal, version, locale)
          const active = controls
          for (const action of [() => active.watchSessions(), () => active.watchAccount(), () => active.loadModels(),
            async () => { await active.loadModes() }]) {
            run(async () => { try { await action() } catch (error) { if (!signal.aborted) throw error } })
          }
        }
        startControls()
        stopConnection = backend().onConnection((state) => {
          connected = state === 'connected'
          ui?.connection(connected)
          if (!connected) { follower?.abort(); liveControls?.abort(); return }
          // Not serialized: an open picker or reader must not defer recovery of the stopped follower and controls.
          run(async () => { startControls(); if (selected !== undefined) await select(selected) })
        })
        title()
        run(async () => {
          // Enabled only by running scripts/setup-tui.sh from a source checkout; the script needs bash.
          const home = ctx.get('dshHomePath')
          if (home === undefined || process.platform === 'win32') return
          const record = await readUpdateRecord(home('addons', 'dsh-tui', 'auto-update.json'))
          if (record === undefined) return
          if (updateDue(record, Date.now())) {
            startUpdate(record)
            ui?.banner({ notice: t('An update from {remote}/{branch} starts after every dsh exits; the new version applies at next start',
              { remote: record.remote, branch: record.branch }) })
          } else if (record.status === 'failed') {
            ui?.banner({ notice: t('Last automatic update failed: {message} · {log}', { message: record.message, log: record.log }) })
          }
        })
        run(async () => {
          const [listed, archived] = await Promise.all([backend().listSessions(lifetime.signal), archivedSessions()])
          const here = await sessionsIn(process.cwd(), listed)
          const [latest] = here.filter(item => !item.blank && !archived.has(item.id) && item.title !== undefined)
            .toSorted((a, b) => b.updatedAt - a.updatedAt)
          if (latest?.title !== undefined) ui?.banner({ last: { title: latest.title, updatedAt: latest.updatedAt } })
        })
        serialize(async () => {
          if (config.session !== undefined) await select(ConversationId(config.session))
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
    liveControls?.abort()
    stopConnection?.()
    await ui?.dispose()
    await connection?.dispose()
    await server?.close()
    await Promise.allSettled([...tasks, operations, interaction, ...following === undefined ? [] : [following]])
  }, 'terminal shutdown')
}
