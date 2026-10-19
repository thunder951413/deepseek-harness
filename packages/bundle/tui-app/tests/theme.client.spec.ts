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
