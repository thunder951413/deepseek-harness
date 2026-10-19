/** The fixed activity panel shown while the model works: a status line, the latest tool, and its details. */
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import { color } from './theme.ts'
import type { TerminalActivity, ToolCall } from './transcript.ts'

/** Rows reserved for the latest call's details, so the panel never changes height during a turn. */
export const DETAIL_ROWS = 3
/** Blank columns left of a detail row. */
const INDENT = '    '

/** Split a line into rows no wider than `room` columns. */
function wrap(line: string, room: number): string[] {
  const rows: string[] = []
  let row = ''
  for (const character of line) {
    if (visibleWidth(row + character) > room) { rows.push(row); row = '' }
    row += character
  }
  return [...rows, row]
}

function detailRows(call: ToolCall, width: number): string[] {
  const room = Math.max(1, width - INDENT.length)
  const rows = call.detail.flatMap(line => wrap(line, room).map(row => ({ row, line })))
  const cut = rows.length > DETAIL_ROWS
  const shown = rows.slice(0, DETAIL_ROWS).map(({ row, line }, index) => {
    const text = cut && index === DETAIL_ROWS - 1 ? `${Array.from(row).slice(0, -1).join('')}…` : row
    return `${INDENT}${line.startsWith('+ ') ? color.green(text) : line.startsWith('- ') ? color.red(text) : color.dim(text)}`
  })
  return [...shown, ...Array.from({ length: DETAIL_ROWS - shown.length }, () => '')]
}

/**
 * Render the panel for a working turn.
 * @param activity - tool calls made since the turn started and the latest one.
 * @param seconds - whole seconds since the turn started.
 * @param width - terminal width in columns.
 * @returns one status line before the first tool call; afterwards the status line, the latest call's
 * title, and a fixed number of detail rows, every row at most `width` columns wide.
 */
export function renderActivity(activity: TerminalActivity, seconds: number, width: number): string[] {
  const counts = activity.calls === 0 ? ''
    : ` · ${String(activity.calls)} tool call${activity.calls === 1 ? '' : 's'}${activity.failed > 0 ? ` · ${String(activity.failed)} failed` : ''}`
  const status = color.dim(truncateToWidth(`✻ Working… ${String(seconds)}s${counts} · Ctrl-C to stop`, width))
  const call = activity.latest
  if (call === undefined) return [status]
  const mark = call.state === 'failed' ? color.red('●') : call.state === 'running' ? color.yellow('●') : color.green('●')
  return [status, truncateToWidth(`${mark} ${color.bold(call.title)}`, width), ...detailRows(call, width).map(row => truncateToWidth(row, width))]
}
