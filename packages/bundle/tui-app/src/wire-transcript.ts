/** Terminal text projection of the shared Web Session journal. */
import { terminalText, type TerminalEntry, type TerminalView } from './transcript.ts'
import type { Json, JournalEvent, StreamFrame } from './port.ts'
import { failureLine, toolTitle } from './tool-view.ts'

function record(value: Json | undefined): { readonly [key: string]: Json } {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as { readonly [key: string]: Json } : {}
}

function list(value: Json | undefined): readonly Json[] {
  return Array.isArray(value) ? value as readonly Json[] : []
}

function text(value: Json | undefined): string {
  return typeof value === 'string' ? value : ''
}

/** Join the text of message content; reasoning blocks are not displayed. */
function content(value: Json | undefined): string {
  if (!Array.isArray(value)) return text(value)
  return list(value).map((item) => {
    const block = record(item)
    if (block.type === 'text') return text(block.text)
    return block.type === 'image' ? '[image]' : ''
  }).filter(Boolean).join('\n')
}

const STATUSES = ['pending', 'in_progress', 'completed'] as const

type Draft = Omit<TerminalEntry, 'seq' | 'id'>

function size(entry: TerminalEntry): number {
  return entry.text.length + (entry.details?.length ?? 0)
}

/**
 * Read the exact persisted arguments for an approval's tool call.
 * @param event - candidate journal event.
 * @param callId - call whose operation requires approval.
 * @returns tool name and arguments, or undefined for another event.
 */
export function approvalCallText(event: JournalEvent, callId: string): string | undefined {
  const data = record(event.data)
  return event.type === 'tool/call' && data.callId === callId
    ? `${text(data.name)}\n${text(data.arguments)}`
    : undefined
}

/** Bounded display projection; durable history remains owned by the Host. */
export class TerminalTranscript {
  private entries: TerminalEntry[] = []
  private live = ''
  private working = false
  private characters = 0
  private readonly byCall = new Map<string, TerminalEntry>()
  private readonly hiddenCalls = new Set<string>()
  private todoEntry: TerminalEntry | undefined

  /** @param maxCharacters - maximum retained text and tool-detail characters. */
  constructor(private readonly maxCharacters: number) {}

  /** Reset the display projection when changing conversations. */
  reset(): void {
    this.entries = []; this.live = ''; this.working = false; this.characters = 0
    this.byCall.clear(); this.hiddenCalls.clear(); this.todoEntry = undefined
  }

  private fit(draft: Draft): Draft {
    const body = terminalText(draft.text).slice(0, this.maxCharacters)
    const details = draft.details === undefined ? undefined
      : terminalText(draft.details).slice(0, Math.max(0, this.maxCharacters - body.length))
    return { ...draft, text: body, ...details === undefined ? {} : { details } }
  }

  private append(event: JournalEvent, draft: Draft): TerminalEntry {
    const entry: TerminalEntry = { ...this.fit(draft), seq: event.seq, id: String(event.seq) }
    this.entries.push(entry)
    this.characters += size(entry)
    if (entry.kind === 'todo') this.todoEntry = entry
    this.trim()
    return entry
  }

  private replace(previous: TerminalEntry, draft: Draft): TerminalEntry | undefined {
    const index = this.entries.indexOf(previous)
    if (index < 0) return undefined
    const next: TerminalEntry = { ...this.fit(draft), seq: previous.seq, id: previous.id }
    this.entries[index] = next
    this.characters += size(next) - size(previous)
    this.trim()
    return next
  }

  private trim(): void {
    while (this.characters > this.maxCharacters && this.entries.length > 1) {
      for (const removed of this.entries.splice(0, 1)) this.characters -= size(removed)
    }
  }

  /**
   * Project a durable event; unknown plugin events stay in the shared history.
   * @param event - event received from the Host controller.
   */
  accept(event: JournalEvent): void {
    const data = record(event.data)
    let shown: Draft | undefined
    switch (event.type) {
      case 'turn/start': this.working = true; this.todoEntry = undefined; break
      case 'user/message':
        if (record(data.source).kind === 'user' || record(data.source).kind === 'user-question-reply') {
          shown = { kind: 'user', text: content(data.content) }
        }
        break
      case 'assistant/message': {
        this.live = ''
        const answer = content(record(data.message).content)
        if (answer !== '') shown = { kind: 'assistant', text: answer }
        break
      }
      case 'todo/write': {
        const todos = list(data.todos).flatMap((item) => {
          const todo = record(item)
          const status = STATUSES.find(candidate => candidate === todo.status)
          return status === undefined ? [] : [{ content: terminalText(text(todo.content)), status }]
        })
        const draft: Draft = { kind: 'todo', text: 'Todos', todos }
        const next = this.todoEntry === undefined ? undefined : this.replace(this.todoEntry, draft)
        if (next === undefined) shown = draft
        else this.todoEntry = next
        break
      }
      case 'tool/call': {
        const name = text(data.name)
        const callId = text(data.callId)
        if (name === 'todo_write') { this.hiddenCalls.add(callId); break }
        const draft: Draft = { kind: 'tool', text: toolTitle(name, text(data.arguments)), state: 'running', details: text(data.arguments) }
        this.byCall.set(callId, this.append(event, draft))
        break
      }
      case 'tool/result': {
        const message = record(data.message)
        const callId = text(message.toolCallId)
        if (this.hiddenCalls.delete(callId)) break
        const result = content(message.content)
        const failed = message.isError === true
        const previous = this.byCall.get(callId)
        this.byCall.delete(callId)
        const draft: Draft = { kind: 'tool', text: previous?.text ?? callId, state: failed ? 'failed' : 'done',
          ...failed ? { preview: failureLine(result) } : {}, details: `${previous?.details ?? ''}\n\n${result}`.trim() }
        if (previous === undefined || this.replace(previous, draft) === undefined) this.append(event, draft)
        break
      }
      case 'assistant/attempt':
        this.live = ''
        shown = { kind: 'status', text: 'Assistant attempt did not complete', details: JSON.stringify(data, null, 2) }
        break
      case 'turn/end': {
        this.working = false
        const reason = record(data.reason)
        if (reason.kind !== 'completed') {
          shown = { kind: 'status', text: text(reason.kind) || 'Turn finished',
            ...reason.kind === 'error' ? { details: text(record(reason.error).message) } : {} }
        }
        break
      }
    }
    if (shown !== undefined) this.append(event, shown)
  }

  /**
   * Restore the unfinished answer from a follow opening snapshot.
   * @param stream - compact attempt records from the Host.
   */
  restore(stream: readonly Json[]): void {
    this.working = true
    this.live = stream.map((item) => {
      const run = record(item)
      return run.type === 'text-chunks' ? list(run.texts).map(text).join('') : ''
    }).join('').slice(-this.maxCharacters)
  }

  /**
   * Append transient text without duplicating its durable settlement.
   * @param frame - current attempt frame.
   */
  stream(frame: StreamFrame): void {
    if (frame.type === 'start') this.working = true
    if (frame.type === 'start' || frame.type === 'end') this.live = ''
    if (frame.type === 'chunk') {
      const chunk = record(frame.chunk)
      if (chunk.type === 'text-delta') this.live = (this.live + text(chunk.text)).slice(-this.maxCharacters)
    }
  }

  /** Read the current display projection.
   * @returns settled blocks and sanitized unfinished text. */
  view(): TerminalView { return { entries: this.entries, live: terminalText(this.live), working: this.working } }
}
