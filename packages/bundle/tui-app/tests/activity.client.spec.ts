/** The activity panel keeps a fixed height and a single row per line while a turn works. */
import { stripVTControlCharacters } from 'node:util'
import { visibleWidth } from '@earendil-works/pi-tui'
import { expect, it } from 'vitest'
import { color } from '../src/theme.ts'
import { DETAIL_ROWS, renderActivity } from '../src/activity.ts'
import { TerminalLocale } from '../src/locale.ts'
import type { ToolCall } from '../src/transcript.ts'

const plain = (rows: string[]): string[] => rows.map(row => stripVTControlCharacters(row))
const call = (state: ToolCall['state'], detail: string[], title = 'Bash(ls)'): ToolCall => ({ id: 'a', title, state, detail, details: '' })

it('reserves the same panel height before the first tool call', () => {
  expect(plain(renderActivity({ calls: 0, failed: 0 }, 3, 80))).toEqual(['✻ Working… 3s · Ctrl-C to stop', '', '', '', ''])
})

it('shows counts, the latest call, and a fixed number of detail rows', () => {
  const rows = plain(renderActivity({ calls: 1, failed: 0, latest: call('running', ['ls -la']) }, 5, 80))
  expect(rows).toEqual(['✻ Working… 5s · 1 tool call · Ctrl-C to stop', '● Bash(ls)', '    ls -la', '', ''])
  const failed = plain(renderActivity({ calls: 12, failed: 2, latest: call('failed', []) }, 19, 80))
  expect(failed[0]).toBe('✻ Working… 19s · 12 tool calls · 2 failed · Ctrl-C to stop')
  expect(failed).toHaveLength(2 + DETAIL_ROWS)
})

it('wraps long lines, ends with an ellipsis when detail is cut, and never exceeds the width', () => {
  const rows = renderActivity({ calls: 1, failed: 0, latest: call('done', ['x'.repeat(100), 'y', 'z', 'w'], 'T'.repeat(60)) }, 1, 30)
  expect(rows.every(row => visibleWidth(row) <= 30)).toBe(true)
  const detail = plain(rows).slice(2)
  expect(detail).toHaveLength(DETAIL_ROWS)
  expect(detail[0]).toBe(`    ${'x'.repeat(26)}`)
  expect(detail[2]?.endsWith('…')).toBe(true)
})

it('colors added and removed lines', () => {
  const rows = renderActivity({ calls: 1, failed: 0, latest: call('done', ['/a', '- old', '+ new']) }, 1, 40)
  expect(rows[3]).toBe(`    ${color.red('- old')}`)
  expect(rows[4]).toBe(`    ${color.green('+ new')}`)
})

it('counts tool calls and failures in the terminal language', () => {
  const zh = new TerminalLocale('zh')
  expect(plain(renderActivity({ calls: 0, failed: 0 }, 2, 80, zh))[0]).toBe('✻ 工作中… 2s · Ctrl-C 停止')
  expect(plain(renderActivity({ calls: 3, failed: 0, latest: call('done', []) }, 2, 80, zh))[0]).toBe('✻ 工作中… 2s · 3 次工具调用 · Ctrl-C 停止')
  expect(plain(renderActivity({ calls: 3, failed: 1, latest: call('failed', []) }, 2, 80, zh))[0]).toBe('✻ 工作中… 2s · 3 次工具调用 · 1 次失败 · Ctrl-C 停止')
})
