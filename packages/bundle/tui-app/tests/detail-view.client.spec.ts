/** Long documents remain navigable independently of terminal scrollback. */
import { expect, it, vi } from 'vitest'
import { stripVTControlCharacters } from 'node:util'
import { DetailView } from '../src/detail-view.ts'
import { TerminalLocale } from '../src/locale.ts'

it('pages, searches literal text, and clamps offsets after resize', () => {
  let rows = 14
  const close = vi.fn()
  const reader = new DetailView('Output', Array.from({ length: 30 }, (_, i) => `row ${i}`).join('\n'), () => rows, new TerminalLocale(), close)
  const render = (): string => reader.render(40).map(line => stripVTControlCharacters(line).trimEnd()).join('\n')
  expect(render()).toContain('row 0\nrow 1\nrow 2\nrow 3')
  reader.handleInput('\x1b[6~')
  expect(render()).toContain('row 4\nrow 5')
  reader.handleInput('/')
  reader.handleInput('row 25')
  reader.handleInput('\r')
  expect(render()).toContain('row 25')
  reader.handleInput('\x1b[F')
  render()
  rows = 40
  expect(render()).toContain('row 0')
  reader.handleInput('\x1b')
  expect(close).toHaveBeenCalledOnce()
})

it('isolates language selection and strips control sequences in document text', () => {
  const zh = new TerminalLocale('zh')
  const en = new TerminalLocale()
  const reader = new DetailView('详情', 'safe\x1b[2Jtext', () => 20, zh, () => {})
  expect(reader.render(100).map(line => stripVTControlCharacters(line).trimEnd()).join('\n')).toContain('safetext')
  expect(reader.render(100).map(line => stripVTControlCharacters(line).trimEnd()).join('\n')).toContain('搜索')
  expect(en.text('Output')).toBe('Output')
})
