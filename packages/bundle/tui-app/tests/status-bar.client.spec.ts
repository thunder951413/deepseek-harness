/** The status rows keep the current conversation visible at every terminal width. */
import { visibleWidth } from '@earendil-works/pi-tui'
import { expect, it } from 'vitest'
import { renderStatus, type StatusItem } from '../src/status-bar.ts'

const plain = (text: string): string => text
const right: StatusItem[] = [
  { text: 'DeepSeek Harness · session-abc', keep: 'start' },
  { text: '/Users/me/project', keep: 'end' },
  { text: 'Web: http://127.0.0.1:1 · /web', keep: 'start' },
]
const left = ['Model: m · Reasoning: high', 'Cache: 90% · Balance: CNY 1.00', '/ commands · Ctrl-Q exit']

it('puts each right item at the end of its row when everything fits', () => {
  const rows = renderStatus(left, right, 120, plain)
  expect(rows).toHaveLength(3)
  expect(rows.every(row => visibleWidth(row) === 120)).toBe(true)
  expect(rows[0]).toMatch(/^Model: m · Reasoning: high +DeepSeek Harness · session-abc$/u)
  expect(rows[1]).toMatch(/^Cache: 90% · Balance: CNY 1.00 +\/Users\/me\/project$/u)
  expect(rows[2]).toMatch(/\/web$/u)
})

it('moves an item that does not fit to its own right-aligned row above the block', () => {
  const rows = renderStatus(left, right, 50, plain)
  expect(rows).toHaveLength(5)
  expect(rows.every(row => visibleWidth(row) <= 50)).toBe(true)
  expect(rows[0]).toMatch(/^ +DeepSeek Harness · session-abc$/u)
  expect(rows[1]).toMatch(/^ +Web: http:\/\/127\.0\.0\.1:1 · \/web$/u)
  expect(rows[3]).toMatch(/^Cache: 90% · Balance: CNY 1\.00 +\/Users\/me\/project$/u)
})

it('keeps the tail of a path and the head of other text when wider than the terminal', () => {
  const rows = renderStatus(['hint'], [
    { text: '/very/long/path/to/the/project', keep: 'end' }, { text: 'abcdefghijklmnop', keep: 'start' },
  ], 12, plain)
  expect(rows[0]).toBe('…the/project')
  expect(rows[1]?.startsWith('abcdefghi')).toBe(true)
  expect(rows.every(row => visibleWidth(row) <= 12)).toBe(true)
})

it('pairs right items with the last left rows, and puts surplus items above', () => {
  const rows = renderStatus(['a', 'b', 'c', 'd'], right, 80, plain)
  expect(rows).toHaveLength(4)
  expect(rows[0]).toBe('a')
  expect(rows[1]).toMatch(/^b +DeepSeek/u)
  expect(renderStatus(['only'], right, 80, plain)).toHaveLength(3)
})

it('measures wide characters and applies the style to right text only', () => {
  const rows = renderStatus(['余额：未提供'], [{ text: 'id', keep: 'start' }], 20, text => `[${text}]`)
  expect(rows[0]).toBe('余额：未提供' + ' '.repeat(20 - 12 - 2) + '[id]')
})
