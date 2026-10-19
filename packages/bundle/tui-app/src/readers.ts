/**
 * Tolerant readers from untyped Harness wire values to terminal types.
 * A reader takes only the fields the terminal displays, ignores unknown fields and unknown
 * variants, and substitutes absence for malformed optional data, so additive Harness changes
 * and unrelated field changes cannot break the terminal.
 */
import type {
  Balance, CatalogModel, FollowFrame, Json, JournalEvent, ModelCatalogView, ModelChoice, Readings, ReadingsChange,
  ReadingsResult, SessionSummary, StreamFrame, Wallet,
} from './port.ts'
import { SessionId } from './port.ts'

type Dict = { readonly [key: string]: unknown }

function dict(value: unknown): Dict { return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Dict : {} }
function list(value: unknown): readonly unknown[] { return Array.isArray(value) ? value : [] }
function str(value: unknown): string | undefined { return typeof value === 'string' && value !== '' ? value : undefined }
function num(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined }

/**
 * Keep a value only when it is plain JSON.
 * @param value - candidate wire value.
 * @returns the value, or null when it holds a non-JSON member.
 */
export function json(value: unknown): Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) return value.map(json)
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, json(item)]))
  }
  return null
}

/**
 * Read a conversation list, dropping rows without an identity and delegated-agent rows.
 * @param value - `session/list` result.
 * @returns human conversations newest first; throws when the result is not a list.
 */
export function readSessionList(value: unknown): SessionSummary[] {
  const items = dict(value).items
  if (!Array.isArray(items)) throw new Error('The conversation list has no items; this Harness is incompatible')
  const rows: SessionSummary[] = []
  for (const item of items) {
    const row = dict(item)
    const id = str(row.sessionId)
    if (id === undefined || row.origin === 'subagent') continue
    const title = str(dict(dict(row.projections).values).title)
    const cwd = str(row.cwd)
    rows.push({ id: SessionId(id), updatedAt: num(row.updatedAt) ?? 0, running: row.running === true,
      ...title === undefined ? {} : { title }, ...cwd === undefined ? {} : { cwd } })
  }
  return rows.sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * Read the identity of a created conversation.
 * @param value - `session/create` result.
 * @returns the identity, or undefined when the result carries none.
 */
export function readCreated(value: unknown): SessionId | undefined {
  const id = str(dict(value).sessionId)
  return id === undefined ? undefined : SessionId(id)
}

/**
 * Read a Workspace creation result.
 * @param value - `workspace/create` result.
 * @returns the Workspace identity text, or undefined when absent.
 */
export function readWorkspaceId(value: unknown): string | undefined {
  return str(dict(dict(value).workspace).workspaceId)
}

function readEvent(value: unknown): JournalEvent | undefined {
  const event = dict(value)
  const type = str(event.type)
  const seq = num(event.seq)
  return type === undefined || seq === undefined ? undefined : { type, seq, data: json(event.data) }
}

function readStream(value: unknown): StreamFrame | undefined {
  const frame = dict(value)
  if (frame.type === 'start' || frame.type === 'end') return { type: frame.type }
  return frame.type === 'chunk' ? { type: 'chunk', chunk: json(frame.chunk) } : undefined
}

/**
 * Read one `session/follow` frame; frames of unknown type are ignored.
 * @param value - wire frame.
 * @returns the frame, or undefined for an unrecognized or malformed frame.
 */
export function readFollowFrame(value: unknown): FollowFrame | undefined {
  const frame = dict(value)
  if (frame.type === 'snapshot') {
    const cwd = str(dict(frame.header).cwd)
    const events = list(frame.records).flatMap(record => readEvent(dict(record).event) ?? [])
    const active = dict(dict(frame.assistantStream).activeAttempt).stream
    return { kind: 'snapshot', events, ...cwd === undefined ? {} : { cwd },
      ...Array.isArray(active) ? { active: active.map(json) } : {} }
  }
  if (frame.type === 'event') {
    const event = readEvent(frame.event)
    return event === undefined ? undefined : { kind: 'event', event }
  }
  if (frame.type === 'assistant-stream') {
    const stream = readStream(frame.frame)
    return stream === undefined ? undefined : { kind: 'stream', frame: stream }
  }
  return undefined
}

function readChoice(value: unknown): ModelChoice | undefined {
  const choice = dict(value)
  const provider = str(choice.provider)
  const model = str(choice.model)
  const reasoningEffort = str(choice.reasoningEffort)
  return provider === undefined || model === undefined ? undefined
    : { provider, model, ...reasoningEffort === undefined ? {} : { reasoningEffort } }
}

function readValues(value: unknown): Readings {
  const values = dict(value)
  const next = readChoice(dict(values.modelSelection).next)
  const usage = dict(values.tokenUsage)
  const stats = dict(values.sessionStats)
  const uncachedInput = num(usage.uncachedInputTokens)
  const cacheRead = num(usage.cacheReadTokens)
  const cacheWrite = num(usage.cacheWriteTokens)
  const output = num(usage.outputTokens)
  const [turns, steps, ttftMs, ttftSteps, decodeMs, decodeTokens] =
    ['turns', 'steps', 'ttftMs', 'ttftSteps', 'decodeMs', 'decodeTokens'].map(key => num(stats[key]))
  return {
    ...next === undefined ? {} : { next },
    ...uncachedInput === undefined || cacheRead === undefined || cacheWrite === undefined || output === undefined ? {}
      : { usage: { uncachedInput, cacheRead, cacheWrite, output } },
    ...turns === undefined || steps === undefined || ttftMs === undefined || ttftSteps === undefined
      || decodeMs === undefined || decodeTokens === undefined ? {}
      : { stats: { turns, steps, ttftMs, ttftSteps, decodeMs, decodeTokens } },
  }
}

/**
 * Read `session/projections`.
 * @param value - wire result; null means no projections.
 * @returns readings, or undefined when absent or of an unknown kind.
 */
export function readReadings(value: unknown): ReadingsResult | undefined {
  const result = dict(value)
  if (result.kind === 'sequenced') return { kind: 'values', readings: readValues(result.values) }
  if (result.kind === 'migration-required') return { kind: 'migration-required', readings: readValues(result.values) }
  return undefined
}

/**
 * Read one `session/control` frame.
 * @param value - wire frame.
 * @returns the change it announces, or undefined for an unrecognized frame.
 */
export function readControlFrame(value: unknown): ReadingsChange | undefined {
  const frame = dict(value)
  if (frame.type === 'baseline') return {}
  const id = str(frame.sessionId)
  const key = str(frame.key)
  return frame.type === 'projection' && id !== undefined && key !== undefined ? { sessionId: SessionId(id), key } : undefined
}

function readModel(value: unknown): CatalogModel | undefined {
  const model = dict(value)
  const id = str(model.id)
  if (id === undefined) return undefined
  const reasoning = dict(model.reasoning)
  const efforts = list(reasoning.efforts).flatMap((item) => {
    const effort = dict(item)
    const effortId = str(effort.id)
    const description = str(effort.description)
    return effortId === undefined ? []
      : [{ id: effortId, name: str(effort.name) ?? effortId, ...description === undefined ? {} : { description } }]
  })
  const defaultEffort = str(reasoning.defaultEffort)
  return { id, name: str(model.name) ?? id, efforts, ...defaultEffort === undefined ? {} : { defaultEffort } }
}

/**
 * Read the model directory, dropping rows without identities.
 * @param value - `session/modelCatalog` result.
 * @returns the directory; missing parts become empty.
 */
export function readCatalog(value: unknown): ModelCatalogView {
  const catalog = dict(value)
  const fallback = readChoice(catalog.default)
  return {
    ...fallback === undefined ? {} : { default: fallback },
    groups: list(catalog.groups).flatMap((item) => {
      const group = dict(item)
      const id = str(group.id)
      const models = list(group.models).flatMap(model => readModel(model) ?? [])
      return id === undefined ? [] : [{ id, name: str(group.name) ?? id, models }]
    }),
    failures: list(catalog.failures).map((item) => {
      const failure = dict(item)
      return { name: str(failure.name) ?? str(failure.id) ?? 'provider', message: str(failure.message) ?? 'lookup failed' }
    }),
  }
}

function readWallets(value: unknown): Wallet[] {
  return list(value).flatMap((item) => {
    const wallet = dict(item)
    const currency = str(wallet.currency)
    const balance = str(wallet.balance)
    return currency === undefined || balance === undefined ? [] : [{ currency, balance }]
  })
}

/**
 * Read the account balance query outcome.
 * @param value - `account/getBalance` result.
 * @returns the outcome; an unrecognized status reads as a failed query.
 */
export function readBalance(value: unknown): Balance {
  if (value === null || value === undefined) return null
  const balance = dict(value)
  return balance.status === 'ready'
    ? { status: 'ready', wallets: readWallets(balance.value), bonusWallets: readWallets(balance.bonusWallets) }
    : { status: 'failed' }
}
