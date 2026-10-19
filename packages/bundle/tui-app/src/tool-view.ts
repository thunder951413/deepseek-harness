/**
 * Terminal summaries of tool calls and results.
 * Known tools get a short title and a diff or result preview; every other tool, and any known
 * tool whose arguments do not parse, falls back to its name and first string argument, so new or
 * renamed Harness tools stay readable without a terminal release.
 */
import { terminalText } from './transcript.ts'

/** Lines of a result or diff shown under a tool title. */
const PREVIEW_LINES = 4
/** Characters kept from one title or preview line. */
const LINE_WIDTH = 100

/** One tool call as the terminal presents it. */
export interface ToolCallView {
  /** Single-line label such as `Bash(ls -la)`. */
  readonly title: string
  /** Lines shown before the result arrives, such as a proposed edit. */
  readonly preview: readonly string[]
}

function clip(value: string, width = LINE_WIDTH): string {
  const line = terminalText(value).replaceAll('\t', '  ')
  return line.length > width ? `${line.slice(0, width - 1)}…` : line
}

function firstLine(value: string): string { return value.split('\n').find(line => line.trim() !== '') ?? '' }

function parse(args: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(args)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch (_error) {
    // Unparseable arguments are shown by the generic title built from the raw text.
    return {}
  }
}

function string(value: unknown): string | undefined { return typeof value === 'string' && value !== '' ? value : undefined }

function changeLines(prefix: '+' | '-', text: string): string[] {
  const lines = text.split('\n')
  const shown = lines.slice(0, PREVIEW_LINES).map(line => `${prefix} ${clip(line)}`)
  return lines.length > PREVIEW_LINES ? [...shown, `${prefix} … +${lines.length - PREVIEW_LINES} lines`] : shown
}

function editorView(args: Record<string, unknown>): ToolCallView | undefined {
  const path = string(args.path)
  if (path === undefined) return undefined
  switch (args.command) {
    case 'view': return { title: `Read(${clip(path)})`, preview: [] }
    case 'create': {
      const lines = (string(args.file_text) ?? '').split('\n').length
      return { title: `Write(${clip(path)})`, preview: [`+ ${lines} lines`] }
    }
    case 'str_replace': return { title: `Edit(${clip(path)})`,
      preview: [...changeLines('-', string(args.old_str) ?? ''), ...changeLines('+', string(args.new_str) ?? '')] }
    case 'insert': return { title: `Insert(${clip(path)})`, preview: changeLines('+', string(args.new_str) ?? '') }
    default: return undefined
  }
}

/**
 * Summarize a tool call from its name and serialized arguments.
 * @param name - tool name.
 * @param args - serialized arguments, possibly malformed.
 * @returns a title and any change preview.
 */
export function toolCallView(name: string, args: string): ToolCallView {
  const parsed = parse(args)
  if (name === 'bash') {
    const command = string(parsed.command)
    if (command !== undefined) return { title: `Bash(${clip(firstLine(command))})`, preview: [] }
  }
  if (name === 'str_replace_editor') {
    const view = editorView(parsed)
    if (view !== undefined) return view
  }
  const hint = string(parsed.description) ?? string(parsed.path) ?? string(parsed.query) ?? string(parsed.command)
    ?? Object.values(parsed).find((value): value is string => typeof value === 'string' && value !== '')
  return { title: hint === undefined ? name : `${name}(${clip(firstLine(hint))})`, preview: [] }
}

/**
 * Keep the leading lines of a tool result.
 * @param content - result text.
 * @returns up to a few clipped lines, ending with a count of the omitted lines.
 */
export function resultPreview(content: string): string[] {
  const lines = terminalText(content).split('\n').filter(line => line.trim() !== '')
  const shown = lines.slice(0, PREVIEW_LINES).map(line => clip(line))
  return lines.length > PREVIEW_LINES ? [...shown, `… +${lines.length - PREVIEW_LINES} lines · /tools`] : shown
}
