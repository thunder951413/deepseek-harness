/** Terminal-owned display data, independent of Harness persistence events. */
import { stripVTControlCharacters } from 'node:util'

/**
 * Remove terminal control sequences from untrusted model and tool text.
 * @param value - text destined for a terminal widget.
 * @returns printable text preserving tabs and line breaks.
 */
export function terminalText(value: string): string {
  return stripVTControlCharacters(value).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/gu, '')
}


/** One immutable block in the terminal's recent conversation window. */
export interface TerminalEntry {
  /** Stable display identity: the journal sequence number of the event that produced the block. */
  readonly id: string
  readonly seq: number
  readonly kind: 'user' | 'assistant' | 'tool' | 'todo' | 'status'
  readonly text: string
  /** Full arguments and output, shown on demand. */
  readonly details?: string
  /** Progress of a tool call. */
  readonly state?: 'running' | 'done' | 'failed'
  /** Lines shown under a tool title: the first line of a failure. */
  readonly preview?: readonly string[]
  /** Current task list for a `todo` entry. */
  readonly todos?: readonly { readonly content: string; readonly status: 'pending' | 'in_progress' | 'completed' }[]
}

/** Recent settled blocks and the unfinished assistant text. */
export interface TerminalView {
  readonly entries: readonly TerminalEntry[]
  readonly live: string
  readonly working: boolean
}
