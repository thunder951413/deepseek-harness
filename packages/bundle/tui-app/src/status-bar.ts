/** Bottom status rows: readings and key hints on the left, the current conversation on the right. */
import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'

/** Blank columns kept between the left text and the right text of one row. */
const GAP = 2

/** One right-aligned item. */
export interface StatusItem {
  /** Plain text; styling is applied by the caller after layout. */
  readonly text: string
  /** Which end survives when the text is wider than the terminal. */
  readonly keep: 'start' | 'end'
}

/**
 * Fit one item into a width, keeping the end the item names.
 * @param item - plain text and the end that survives truncation.
 * @param width - available columns.
 * @returns the text unchanged when it fits, otherwise truncated with an ellipsis at the dropped end.
 */
export function fit(item: StatusItem, width: number): string {
  if (visibleWidth(item.text) <= width) return item.text
  if (item.keep === 'start') return truncateToWidth(item.text, width)
  let tail = item.text
  while (tail !== '' && visibleWidth(`…${tail}`) > width) tail = tail.slice(1)
  return `…${tail}`
}

/**
 * Lay out status rows with the right items aligned to the last left rows.
 * An item that does not fit beside its left text gets its own right-aligned row above the block,
 * so the current conversation stays visible at any terminal width.
 * @param left - styled rows, top to bottom.
 * @param right - items, top to bottom, paired with the last rows of `left`.
 * @param width - terminal width in columns.
 * @param style - applied to right text after layout.
 * @returns the rows to display, every one at most `width` columns wide.
 */
export function renderStatus(left: readonly string[], right: readonly StatusItem[], width: number,
  style: (text: string) => string): string[] {
  const offset = Math.max(0, left.length - right.length)
  const above: string[] = []
  const rows = left.map(row => truncateToWidth(row, width))
  right.forEach((item, index) => {
    const row = offset + index
    const beside = left[row]
    const text = fit(item, Math.max(1, width))
    const used = beside === undefined ? width : visibleWidth(beside) + GAP + visibleWidth(text)
    if (beside !== undefined && used <= width) {
      rows[row] = `${beside}${' '.repeat(width - visibleWidth(beside) - visibleWidth(text))}${style(text)}`
    } else above.push(`${' '.repeat(width - visibleWidth(text))}${style(text)}`)
  })
  return [...above, ...rows]
}
