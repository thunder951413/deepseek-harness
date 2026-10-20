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


/** One tool call inside a group. */
export interface ToolCall {
  /** Tool call identity from the journal. */
  readonly id: string
  /** Single-line label such as `Bash(ls -la)`. */
  readonly title: string
  readonly state: 'running' | 'done' | 'failed'
  /** Up to a few lines describing the invocation: a command, a path, or leading arguments. */
  readonly detail: readonly string[]
  /** Full arguments and output, shown on demand. */
  readonly details: string
  /** Character count of the sanitized arguments at the start of details. */
  readonly argumentLength?: number
  /** Retained details omit part of the original call. */
  readonly truncated?: boolean
}

/** Consecutive tool calls shown as one block. */
export interface ToolGroup {
  /** Most recent calls, oldest first. */
  readonly calls: readonly ToolCall[]
  /** Calls made in the group, including those no longer listed. */
  readonly count: number
  readonly failed: number
}

/** One immutable block in the terminal's recent conversation window. */
export interface TerminalEntry {
  /** Stable display identity: the journal sequence number of the event that produced the block. */
  readonly id: string
  readonly seq: number
  readonly kind: 'user' | 'assistant' | 'tools' | 'todo' | 'status'
  readonly text: string
  /** Full arguments and output, shown on demand. */
  readonly details?: string
  /** Calls of a `tools` block. */
  readonly group?: ToolGroup
  /** Current task list for a `todo` entry. */
  readonly todos?: readonly { readonly content: string; readonly status: 'pending' | 'in_progress' | 'completed' }[]
}

/** What the model is doing now, for the fixed activity panel. */
export interface TerminalActivity {
  /** Event-derived work phase; omission means no finer status is available. */
  readonly phase?: 'Waiting for model' | 'Receiving response' | 'Running tool' | 'Waiting for approval' | 'Waiting for answer'
  /** Tool calls made since the turn started. */
  readonly calls: number
  readonly failed: number
  /** Latest call of the turn, absent before the first call. */
  readonly latest?: ToolCall
}

/** Recent settled blocks and the unfinished assistant text. */
export interface TerminalView {
  /** Earlier history or tool output was omitted from this view. */
  readonly truncated?: boolean
  readonly entries: readonly TerminalEntry[]
  readonly live: string
  readonly working: boolean
  readonly activity: TerminalActivity
}
