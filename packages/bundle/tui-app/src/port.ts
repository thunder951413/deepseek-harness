/**
 * The terminal's view of a Harness: the only vocabulary the application, controls, and UI use.
 * Nothing here imports a Harness package; the Web Remote adapter translates wire values into
 * these types, so Harness releases can change wire details without touching the terminal.
 */

/** Plain JSON value carried by journal events and assistant stream chunks. */
export type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json }

/** Opaque conversation identity. */
export type SessionId = string & { readonly __sessionId: never }

/**
 * Brand a conversation identity received from a user, a Harness, or an earlier run.
 * @param value - non-empty identity text.
 * @returns the branded identity.
 */
export function SessionId(value: string): SessionId { return value as SessionId }

/** One persisted conversation in a history list. */
export interface SessionSummary {
  readonly id: SessionId
  readonly updatedAt: number
  readonly running: boolean
  readonly title?: string
  readonly cwd?: string
}

/** One durable event from a Session journal. */
export interface JournalEvent {
  readonly type: string
  readonly seq: number
  readonly data: Json
}

/** Transient assistant output that precedes its durable settlement. */
export type StreamFrame =
  | { readonly type: 'start' | 'end' }
  | { readonly type: 'chunk'; readonly chunk: Json }

/** One update from following a conversation. */
export type FollowFrame =
  | {
    readonly kind: 'snapshot'
    readonly cwd?: string
    readonly events: readonly JournalEvent[]
    /** Compact records of an unfinished assistant attempt. */
    readonly active?: readonly Json[]
  }
  | { readonly kind: 'event'; readonly event: JournalEvent }
  | { readonly kind: 'stream'; readonly frame: StreamFrame }

/** A model route and optional reasoning effort. */
export interface ModelChoice {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** One selectable reasoning level. */
export interface EffortChoice {
  readonly id: string
  readonly name: string
  readonly description?: string
}

/** One model with its reasoning levels. */
export interface CatalogModel {
  readonly id: string
  readonly name: string
  readonly efforts: readonly EffortChoice[]
  readonly defaultEffort?: string
}

/** Models offered by the Harness and provider lookup failures. */
export interface ModelCatalogView {
  readonly default?: ModelChoice
  readonly groups: readonly { readonly id: string; readonly name: string; readonly models: readonly CatalogModel[] }[]
  readonly failures: readonly { readonly name: string; readonly message: string }[]
}

/** Whole-conversation readings; an absent field means the Harness did not report it. */
export interface Readings {
  readonly next?: ModelChoice
  readonly usage?: {
    readonly uncachedInput: number
    readonly cacheRead: number
    readonly cacheWrite: number
    readonly output: number
  }
  readonly stats?: {
    readonly turns: number
    readonly steps: number
    readonly ttftMs: number
    readonly ttftSteps: number
    readonly decodeMs: number
    readonly decodeTokens: number
  }
}

/** Result of reading conversation readings. */
export type ReadingsResult =
  | { readonly kind: 'values'; readonly readings: Readings }
  | { readonly kind: 'migration-required'; readonly readings: Readings }

/** One account wallet. */
export interface Wallet {
  readonly currency: string
  readonly balance: string
}

/** Account balance outcome; null means the Harness has no signed-in account to query. */
export type Balance = null
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly wallets: readonly Wallet[]; readonly bonusWallets: readonly Wallet[] }

/** A live change that should refresh readings. */
export interface ReadingsChange {
  /** Absent for a full baseline. */
  readonly sessionId?: SessionId
  readonly key?: string
}

/** One question shown to the human. */
export interface PortQuestion {
  readonly id: string
  readonly question: string
  readonly detail?: string
  readonly options?: readonly { readonly label: string; readonly description?: string }[]
  readonly multiSelect?: boolean
}

/** One answer to a question. */
export interface PortAnswer {
  readonly id: string
  readonly selected: string[]
  readonly custom?: string
}

/** A pending tool approval. */
export interface PortApproval {
  readonly sessionId: SessionId
  readonly toolName: string
  readonly callId?: string
  readonly reason?: string
  readonly signal?: AbortSignal
}

/** Approval decision returned to the Harness. */
export type PortApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** A pending question set. */
export interface PortQuestionRequest {
  readonly sessionId: SessionId
  readonly questions: readonly PortQuestion[]
  readonly signal?: AbortSignal
  /** A timed wait the terminal must claim while it holds the foreground. */
  readonly wait?: { readonly callId: string; readonly timed: boolean }
}

/** Optional features, set once at connection from what the Harness answered. */
export interface Capabilities {
  /** Model catalog and selection. */
  readonly models: boolean
  /** Whole-conversation usage readings and live changes. */
  readonly readings: boolean
  /** Account balance. */
  readonly balance: boolean
  /** Human questions raised by the model. */
  readonly questions: boolean
}

/** Connected Harness operations. Optional operations resolve to undefined or throw `Unsupported`. */
export interface HarnessPort {
  /** Browser launch URL for the connected Harness. */
  readonly url: string
  /** Optional features the Harness answered during connection. */
  readonly capabilities: Capabilities
  /**
   * List human conversations.
   * @param signal - cancellation.
   * @returns persisted conversations in Harness order.
   */
  listSessions(signal: AbortSignal): Promise<SessionSummary[]>
  /**
   * Create a conversation in a directory.
   * @param directory - absolute working directory.
   * @returns the new conversation identity.
   */
  createSession(directory: string): Promise<SessionId>
  /**
   * Follow a conversation from a bounded opening window.
   * @param sessionId - conversation to follow.
   * @param historyMessages - maximum opening messages.
   * @param signal - cancellation.
   * @returns snapshot, durable events, and assistant stream frames.
   */
  follow(sessionId: SessionId, historyMessages: number, signal: AbortSignal): AsyncIterable<FollowFrame>
  /**
   * Queue a user message.
   * @param sessionId - conversation.
   * @param text - message text.
   * @param signal - cancellation of the admission request.
   */
  prompt(sessionId: SessionId, text: string, signal: AbortSignal): Promise<void>
  /**
   * Stop generation in a conversation.
   * @param sessionId - conversation.
   */
  cancel(sessionId: SessionId): Promise<void>
  /**
   * Find the arguments of a tool call that needs approval.
   * @param sessionId - conversation.
   * @param callId - tool call.
   * @param signal - cancellation.
   * @returns tool name and arguments, or undefined when the journal does not show them.
   */
  readToolCall(sessionId: SessionId, callId: string, signal: AbortSignal): Promise<string | undefined>
  /**
   * Read whole-conversation readings.
   * @param sessionId - conversation.
   * @param signal - cancellation.
   * @returns readings, or undefined when the conversation has none.
   */
  readings(sessionId: SessionId, signal: AbortSignal): Promise<ReadingsResult | undefined>
  /**
   * Observe changes that invalidate readings.
   * @param signal - cancellation.
   * @returns one item per live change.
   */
  watchReadings(signal: AbortSignal): AsyncIterable<ReadingsChange>
  /**
   * Read available models.
   * @returns the catalog; throws `Unsupported` when absent.
   */
  modelCatalog(): Promise<ModelCatalogView>
  /**
   * Choose the model for a conversation's next request.
   * @param sessionId - conversation.
   * @param choice - provider, model, and effort.
   */
  selectModel(sessionId: SessionId, choice: ModelChoice): Promise<void>
  /**
   * Observe account changes.
   * @param signal - cancellation.
   * @returns one item per account change.
   */
  watchAccount(signal: AbortSignal): AsyncIterable<void>
  /**
   * Read the signed-in account balance.
   * @param client - terminal version and locale for the query.
   * @returns the balance outcome.
   */
  balance(client: { version: string; locale: string; timezoneOffsetSeconds: number }): Promise<Balance>
  /**
   * Answer tool approvals for the conversation selected in the terminal.
   * @param listener - returns undefined to leave the request to other clients.
   */
  onApproval(listener: (request: PortApproval) => Promise<PortApprovalOutcome | undefined>): void
  /**
   * Answer model questions for the conversation selected in the terminal.
   * @param listener - returns undefined to leave the request to other clients.
   */
  onQuestion(listener: (request: PortQuestionRequest) => Promise<{ answers: PortAnswer[] } | undefined>): void
  /**
   * Hold a timed question's foreground claim.
   * @param sessionId - conversation.
   * @param callId - pending tool call.
   * @param signal - claim lifetime.
   * @returns frames until cancellation.
   */
  holdQuestion(sessionId: SessionId, callId: string, signal: AbortSignal): AsyncIterable<unknown>
  /** Release the connection.
   * @returns after transport and answer tasks have closed. */
  dispose(): Promise<void>
}

/** The connected Harness does not offer an optional operation. */
export class Unsupported extends Error {
  /** @param feature - name of the missing feature. */
  constructor(readonly feature: string) {
    super(`This Harness does not provide ${feature}`)
    this.name = 'Unsupported'
  }
}
