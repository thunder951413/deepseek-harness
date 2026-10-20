/** Instance-owned interface language: dictionary lookup and placeholder substitution. */
import { expect, it } from 'vitest'
import { TerminalLocale } from '../src/locale.ts'

it('fills placeholders, keeps unknown ones literal, and translates only owned descriptions', () => {
  const locale = new TerminalLocale()
  expect(locale.text('Saved to {path}', { path: '/a.zip' })).toBe('Saved to /a.zip')
  expect(locale.text('Saved to {path}')).toBe('Saved to {path}')
  locale.language = 'zh'
  expect(locale.text('Saved to {path}', { path: '/a.zip' })).toBe('已保存到 /a.zip')
  expect(locale.description('Manage pending messages')).toBe('管理待执行消息')
  expect(locale.description('A description from elsewhere')).toBe('A description from elsewhere')
})
