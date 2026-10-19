/**
 * The only file that speaks the Harness Web Remote protocol.
 * It issues calls through the generated Remote methods, converts every result with the tolerant
 * readers, and reports optional features the Harness lacks as `Unsupported` instead of failing.
 */
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { Context } from '@deepseek-ai/cordis'
import { installConnection, type ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import * as Gateway from '@deepseek-ai/dsh-api-gateway/client'
import * as Registry from '@deepseek-ai/dsh-typert-registry/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-remotes/types'
import sessionInfo from '@deepseek-ai/dsh-api-session-controller/remote'
import workspaceInfo from '@deepseek-ai/dsh-api-workspace-controller/remote'
import accountInfo from '@deepseek-ai/dsh-api-account-controller/remote'
import questionInfo from '@deepseek-ai/dsh-user-questions/remote'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId as WireSessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-user-approval/types'
import type {} from '@deepseek-ai/dsh-user-questions/types'
import {
  SessionId, Unsupported, type Capabilities, type HarnessPort, type ModelChoice, type PortApprovalOutcome,
  type PortAnswer, type PortQuestion, type PortQuestionRequest, type PortApproval,
} from './port.ts'
import {
  readBalance, readCatalog, readControlFrame, readCreated, readFollowFrame, readReadings, readSessionList, readWorkspaceId,
} from './readers.ts'
import { approvalCallText } from './wire-transcript.ts'

/** Wire error codes answered for a method or service the Harness does not mount. */
const MISSING = new Set<string>(['gateway/invocation-unavailable', 'gateway/definition-unavailable',
  'gateway/service-unavailable', 'gateway/method-unavailable'])

function wire(id: SessionId): WireSessionId { return id as string as WireSessionId }

function text(value: unknown): string | undefined { return typeof value === 'string' && value !== '' ? value : undefined }

function questionItems(value: unknown): PortQuestion[] {
  return (Array.isArray(value) ? value : []).flatMap((item: unknown): PortQuestion[] => {
    const question = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {}
    const id = text(question.id)
    const prompt = text(question.question)
    if (id === undefined || prompt === undefined) return []
    const detail = text(question.detail)
    const options = Array.isArray(question.options) ? question.options.flatMap((option: unknown) => {
      const row = typeof option === 'object' && option !== null ? option as Record<string, unknown> : {}
      const label = text(row.label)
      const description = text(row.description)
      return label === undefined ? [] : [{ label, ...description === undefined ? {} : { description } }]
    }) : undefined
    return [{ id, question: prompt, ...detail === undefined ? {} : { detail },
      ...options === undefined ? {} : { options }, ...question.multiSelect === true ? { multiSelect: true } : {} }]
  })
}

/** Authenticated Web Remote connection implementing the terminal's Harness port. */
export class WebRemotePort implements HarnessPort {
  private readonly client = new Context()
  private readonly scopes = new WeakMap<object, WireSessionId>()
  private readonly features: { -readonly [Key in keyof Capabilities]: boolean } =
    { models: true, readings: true, balance: true, questions: true }
  private connection: ConnectionHandle | undefined
  private startupSignal: AbortSignal | undefined

  private constructor(readonly url: string) {}

  /** @returns optional features the Harness has answered so far. */
  get capabilities(): Capabilities { return { ...this.features } }

  private remote() { return this.client.remote }

  /** Return a required call's value or throw its wire failure. */
  private required<T>(endpoint: string, result: RemoteResult<T>): T {
    if (!result.ok) throw new Error(`${endpoint}: ${result.error.code}: ${result.error.message}`)
    return result.value
  }

  /** Return an optional call's value; a method the Harness lacks clears its feature and throws `Unsupported`. */
  private optional<T>(feature: keyof Capabilities, endpoint: string, result: RemoteResult<T>): T {
    if (!result.ok && MISSING.has(result.error.code)) {
      this.features[feature] = false
      throw new Unsupported(endpoint)
    }
    return this.required(endpoint, result)
  }

  /**
   * Exchange a launch URL for an API Peer and verify the required conversation interfaces.
   * Optional features are probed and recorded; their absence does not fail the connection.
   * @param url - authenticated Web launch URL; its token is never logged.
   * @param signal - startup cancellation and deadline.
   * @returns the connected port.
   */
  static async connect(url: string, signal: AbortSignal): Promise<WebRemotePort> {
    const source = new URL(url)
    if (!['http:', 'https:'].includes(source.protocol) || source.username !== '' || source.password !== '') throw new Error('Expected an HTTP(S) Harness URL')
    const connect = new URL('connect', source)
    connect.searchParams.set('token', source.searchParams.get('token') ?? '')
    connect.searchParams.set('interactions', 'answer')
    const response = await fetch(connect, { redirect: 'manual', signal })
    if (response.status !== 302) throw new Error(`Harness authentication failed (${response.status}); use its current launch URL`)
    const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    if (cookie === '') throw new Error('Harness did not issue an API credential')
    const port = new WebRemotePort(url)
    try {
      port.startupSignal = signal
      const base = new URL(source)
      base.search = ''
      installConnection(port.client, { interactions: 'answer', transport: {
        streamBaseUrl: base.href,
        fetch: (input, init) => fetch(new URL(String(input).replace(/^\//u, ''), base), {
          ...init, signal: port.startupSignal === undefined ? (init.signal ?? null) : AbortSignal.any([port.startupSignal,
            ...init.signal == null ? [] : [init.signal]]),
          headers: { ...Object.fromEntries(new Headers(init.headers)), cookie },
        }),
        createWebSocket: socket => new WebSocket(socket, { headers: { cookie } }),
      } })
      port.connection = port.client.get('connection') as ConnectionHandle
      await port.client.plugin(Registry)
      port.client.effect(() => port.client.typert.contexts.registerClient('agent', {
        identity: value => port.scopes.get(value),
        resolve: (id) => {
          const scope = port.client.extend()
          port.scopes.set(scope, id)
          return scope
        },
      }), 'tui.remote.agent-context')
      await port.client.plugin(Gateway)
      for (const info of [sessionInfo, workspaceInfo, accountInfo, questionInfo]) {
        await port.client.remote.$mount({ package: info.package, descriptors: info.descriptors })
      }
      await port.waitReady(signal)
      readSessionList(port.required('session/list', await port.remote().session.list({}, signal)))
      try { await port.modelCatalog() } catch (error) { if (!(error instanceof Unsupported)) port.features.models = false }
      port.startupSignal = undefined
      return port
    } catch (error) {
      await port.dispose()
      throw new Error('This Harness cannot provide the required terminal interfaces; install a compatible TUI adapter', { cause: error })
    }
  }

  private async waitReady(signal: AbortSignal): Promise<void> {
    const connection = this.connection
    if (connection === undefined) throw new Error('Missing terminal transport')
    if (connection.generation.getSnapshot() !== undefined) return
    await new Promise<void>((resolve, reject) => {
      const finish = (): void => {
        signal.removeEventListener('abort', abort)
        stop()
        if (signal.aborted) reject(signal.reason instanceof Error ? signal.reason : new Error('Terminal connection cancelled'))
        else resolve()
      }
      const abort = (): void => { finish() }
      const stop = connection.generation.subscribe(() => {
        if (connection.generation.getSnapshot() !== undefined) finish()
      })
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted || connection.generation.getSnapshot() !== undefined) finish()
    })
  }

  async listSessions(signal: AbortSignal) {
    return readSessionList(this.required('session/list', await this.remote().session.list({}, signal)))
  }

  async createSession(directory: string): Promise<SessionId> {
    const workspace = this.required('workspace/create', await this.remote().workspace.create({ path: directory }))
    const workspaceId = readWorkspaceId(workspace)
    if (workspaceId === undefined) throw new Error('workspace/create: the Harness returned no Workspace identity')
    const created = readCreated(this.required('session/create',
      await this.remote().session.create({ workspaceId: workspaceId as WorkspaceId })))
    if (created === undefined) throw new Error('session/create: the Harness returned no conversation identity')
    return created
  }

  async *follow(sessionId: SessionId, historyMessages: number, signal: AbortSignal) {
    for await (const raw of this.remote().session.follow({
      address: { kind: 'session', sessionId: wire(sessionId) }, maxMessages: historyMessages, assistantStream: true,
    }, signal)) {
      const frame = readFollowFrame(raw)
      if (frame !== undefined) yield frame
    }
  }

  async prompt(sessionId: SessionId, text: string, signal: AbortSignal): Promise<void> {
    this.required('session/prompt', await this.remote().session.prompt({
      requestId: brandString<SessionRequestId>(randomUUID()), sessionId: wire(sessionId), mode: 'queue',
      content: [{ type: 'text', text }], clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }, signal))
  }

  async cancel(sessionId: SessionId): Promise<void> {
    this.required('session/cancel', await this.remote().session.cancel({ sessionId: wire(sessionId) }))
  }

  async readToolCall(sessionId: SessionId, callId: string, signal: AbortSignal): Promise<string | undefined> {
    for (const maxMessages of [1, 50]) {
      for await (const raw of this.remote().session.follow({ address: { kind: 'session', sessionId: wire(sessionId) }, maxMessages }, signal)) {
        const frame = readFollowFrame(raw)
        if (frame?.kind !== 'snapshot') throw new Error('Approval history did not start with a snapshot')
        const found = frame.events.map(event => approvalCallText(event, callId)).find(value => value !== undefined)
        if (found !== undefined) return found
        break
      }
    }
    return undefined
  }

  async readings(sessionId: SessionId, signal: AbortSignal) {
    return readReadings(this.optional('readings', 'session/projections',
      await this.remote().session.projections({ sessionId: wire(sessionId) }, signal)))
  }

  async *watchReadings(signal: AbortSignal) {
    for await (const raw of this.remote().session.control(signal)) {
      const change = readControlFrame(raw)
      if (change !== undefined) yield change
    }
  }

  async modelCatalog() {
    return readCatalog(this.optional('models', 'session/modelCatalog', await this.remote().session.modelCatalog()))
  }

  async selectModel(sessionId: SessionId, choice: ModelChoice): Promise<void> {
    this.optional('models', 'session/selectModel', await this.remote().session.selectModel({ sessionId: wire(sessionId), ...choice }))
  }

  async *watchAccount(signal: AbortSignal) {
    for await (const _state of this.remote().account.watch(signal)) yield
  }

  async balance(client: { version: string; locale: string; timezoneOffsetSeconds: number }) {
    return readBalance(this.optional('balance', 'account/getBalance', await this.remote().account.getBalance(client)))
  }

  onApproval(listener: (request: PortApproval) => Promise<PortApprovalOutcome | undefined>): void {
    this.client.remote.$on('approval/request', async (request, next) => {
      const toolName = text(request.toolName)
      const scoped = this.scopes.get(request.agent)
      if (toolName === undefined || scoped === undefined) return next()
      const sessionId = SessionId(scoped)
      const callId = text(request.callId)
      const reason = text(request.reason)
      const outcome = await listener({ sessionId, toolName, ...callId === undefined ? {} : { callId },
        ...reason === undefined ? {} : { reason }, ...request.signal === undefined ? {} : { signal: request.signal } })
      return outcome === undefined ? next() : outcome
    })
  }

  onQuestion(listener: (request: PortQuestionRequest) => Promise<{ answers: PortAnswer[] } | undefined>): void {
    this.client.remote.$on('user-questions/request', async (request, next) => {
      const scoped = request.agent === undefined ? undefined : this.scopes.get(request.agent)
      const questions = questionItems(request.questions)
      if (scoped === undefined || questions.length === 0) return next()
      const sessionId = SessionId(scoped)
      const callId = text(request.wait?.callId)
      const outcome = await listener({ sessionId, questions,
        ...request.signal === undefined ? {} : { signal: request.signal },
        ...callId === undefined ? {} : { wait: { callId, timed: request.wait?.timed === true } } })
      return outcome === undefined ? next() : outcome
    })
  }

  holdQuestion(sessionId: SessionId, callId: string, signal: AbortSignal): AsyncIterable<unknown> {
    return this.remote().userQuestions.attachWait(wire(sessionId), callId as ToolCallId, signal)
  }

  async dispose(): Promise<void> {
    await this.client.fiber.dispose()
  }
}
