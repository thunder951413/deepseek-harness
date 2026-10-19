/** Colors honor NO_COLOR and code highlighting falls back to plain text. */
import { afterEach, expect, it, vi } from 'vitest'

const original = process.env.NO_COLOR
afterEach(() => {
  if (original === undefined) delete process.env.NO_COLOR
  else process.env.NO_COLOR = original
  vi.resetModules()
})

it('colors output by default and stays plain with NO_COLOR', async () => {
  delete process.env.NO_COLOR
  vi.resetModules()
  const colored = await import('../src/theme.ts')
  expect(colored.color.red('x')).toContain('\x1b[')
  expect(colored.selectTheme.noMatch('')).toContain('No matches')
  process.env.NO_COLOR = '1'
  vi.resetModules()
  const plain = await import('../src/theme.ts')
  expect(plain.color.red('x')).toBe('x')
  expect(plain.editorTheme.selectList).toBe(plain.selectTheme)
})

it('highlights known languages and leaves unknown languages untouched', async () => {
  const { markdownTheme } = await import('../src/theme.ts')
  expect(markdownTheme.highlightCode?.('const a = 1', 'typescript').join('\n')).toContain('const')
  expect(markdownTheme.highlightCode?.('a\nb', 'no-such-language')).toEqual(['a', 'b'])
  expect(markdownTheme.highlightCode?.('a', undefined)).toEqual(['a'])
  expect(markdownTheme.codeBlock('raw')).toBe('raw')
})

it('estimates color depth and paints the input background only when enabled and visible', async () => {
  const { blockBackground, colorLevel, inputBackground } = await import('../src/theme.ts')
  expect(colorLevel({ NO_COLOR: '1', COLORTERM: 'truecolor' })).toBe(0)
  expect([colorLevel({ COLORTERM: 'truecolor' }), colorLevel({ COLORTERM: '24bit' })]).toEqual([3, 3])
  expect([colorLevel({ TERM: 'xterm-256color' }), colorLevel({ TERM: 'vt100' }), colorLevel({})]).toEqual([2, 1, 1])
  expect(inputBackground('#2b2f38', 3)?.('x')).toBe('\x1b[48;2;43;47;56mx\x1b[49m')
  expect(inputBackground('#2b2f38', 2)?.('x')).toContain('\x1b[48;5;')
  expect(inputBackground('', 3)).toBeUndefined()
  expect(inputBackground('#2b2f38', 0)).toBeUndefined()
  expect(blockBackground('#212a38', 3)?.('x')).toBe('\x1b[48;2;33;42;56mx\x1b[49m')
  expect(blockBackground('#212a38', 2)).toBeTypeOf('function')
  expect(blockBackground('#212a38', 1)).toBeUndefined()
  expect(blockBackground('', 3)).toBeUndefined()
  expect(blockBackground('#212a38')).toBeTypeOf(process.env.NO_COLOR === undefined && colorLevel(process.env) >= 2 ? 'function' : 'undefined')
  expect(inputBackground('#2b2f38')).toBeTypeOf(process.env.NO_COLOR === undefined ? 'function' : 'undefined')
})
