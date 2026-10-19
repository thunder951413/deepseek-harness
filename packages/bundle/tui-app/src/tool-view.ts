/**
 * One-line terminal titles for tool calls and the first line of a failure.
 * Known tools get a short title; every other tool, and any known tool whose arguments do not
 * parse, falls back to its name and first string argument, so new or renamed Harness tools stay
 * readable without a terminal release.
 */
import { terminalText } from './transcript.ts'

/** Characters kept from one title or failure line. */
const LINE_WIDTH = 100

function clip(value: string): string {
  const line = terminalText(value).replaceAll('\t', '  ')
  return line.length > LINE_WIDTH ? `${line.slice(0, LINE_WIDTH - 1)}…` : line
}

function firstLine(value: string): string { return value.split('\n').find(line => line.trim() !== '') ?? '' }

function parse(args: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(args)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch (_error) {
    // Unparseable arguments are shown by the generic title built from the tool name.
    return {}
  }
}

function string(value: unknown): string | undefined { return typeof value === 'string' && value !== '' ? value : undefined }

const EDITOR_VERBS = new Map([['view', 'Read'], ['create', 'Write'], ['str_replace', 'Edit'], ['insert', 'Insert']])

/**
 * Title a tool call from its name and serialized arguments.
 * @param name - tool name.
 * @param args - serialized arguments, possibly malformed.
 * @returns a single-line label such as `Bash(ls -la)` or `Edit(/repo/a.ts)`.
 */
export function toolTitle(name: string, args: string): string {
  const parsed = parse(args)
  const command = string(parsed.command)
  if (name === 'bash' && command !== undefined) return `Bash(${clip(firstLine(command))})`
  const path = string(parsed.path)
  const verb = EDITOR_VERBS.get(command ?? '')
  if (name === 'str_replace_editor' && path !== undefined && verb !== undefined) return `${verb}(${clip(path)})`
  const hint = string(parsed.description) ?? path ?? string(parsed.query) ?? command
    ?? Object.values(parsed).find((value): value is string => typeof value === 'string' && value !== '')
  return hint === undefined ? name : `${name}(${clip(firstLine(hint))})`
}

/**
 * Keep the first line of a failed tool result.
 * @param content - result text.
 * @returns zero or one clipped line.
 */
export function failureLine(content: string): string[] {
  const line = firstLine(terminalText(content))
  return line === '' ? [] : [clip(line)]
}
