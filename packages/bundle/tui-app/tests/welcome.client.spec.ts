/** The start-of-conversation banner: the pixel whale, its drift, centered facts, and relative times. */
import { stripVTControlCharacters } from 'node:util'
import { visibleWidth } from '@earendil-works/pi-tui'
import { expect, it } from 'vitest'
import { TerminalLocale } from '../src/locale.ts'
import { relativeAge, renderWelcome, whaleRows, WelcomeBanner, type WelcomeInfo } from '../src/welcome.ts'

const now = Date.UTC(2026, 9, 20)
const commands = ['new', 'clear', 'resume', 'model', 'effort', 'stats', 'tools', 'help'].map(name => ({ name, description: `About ${name}` }))
const skills = [{ name: 'dsh-doc', description: 'Write documentation' }, { name: 'dsh-code-review', description: 'Review a pull request' },
  { name: 'simplify', description: '' }, { name: 'loop', description: 'Repeat a prompt' }]
const info: WelcomeInfo = { version: '1.2.3', model: 'test/model · high', directory: '/work/project', commands, skills,
  last: { title: 'Fix the queue', updatedAt: now - 3 * 3600000 } }
const unknownSkills: WelcomeInfo = { version: '1.2.3', commands }
const plain = (rows: string[]): string[] => rows.map(row => stripVTControlCharacters(row))

it('draws the whale with half blocks and the same height in every frame', () => {
  const frames = Array.from({ length: 4 }, (_unused, frame) => plain(whaleRows(frame, 0)))
  for (const rows of frames) {
    expect(rows).toHaveLength(12)
    expect(rows.every(row => visibleWidth(row) === 30)).toBe(true)
    expect(rows.join('')).toMatch(/[▀▄█]/u)
  }
  expect(whaleRows(1, 3).join('')).toContain('\x1b[38;2;97;133;246m')
})

it('bobs one pixel at a time and repeats every four frames', () => {
  const frames = Array.from({ length: 5 }, (_unused, frame) => plain(whaleRows(frame, 0)))
  expect(frames[0]).toEqual(frames[4])
  expect(new Set(frames.slice(0, 4).map(rows => rows.join('\n'))).size).toBe(3)
  expect(frames[0]).not.toEqual(frames[1])
  expect(frames[1]).toEqual(whaleRows(3, 0).map(row => stripVTControlCharacters(row)))
})

it('centers the whale, the identity, and how to continue the last conversation', () => {
  const rows = plain(renderWelcome(info, 64, 40, 0, new TerminalLocale(), now))
  expect(rows.every(row => visibleWidth(row) <= 64)).toBe(true)
  const text = rows.join('\n')
  for (const expected of ['DeepSeek v1.2.3', 'test/model · high', '/work/project', 'Continue: Fix the queue · 3 hours ago · /resume']) {
    expect(text).toContain(expected)
  }
  expect(text).toMatch(/[▀▄█]/u)
  const title = rows.find(row => row.includes('DeepSeek v1.2.3')) ?? ''
  expect(title.search(/\S/u)).toBe(Math.floor((64 - visibleWidth(title.trim())) / 2))
})

it('centers the whale and the text below it in the space left of the lists, or across the width without them', () => {
  const rows = plain(renderWelcome(info, 120, 40, 0, new TerminalLocale(), now))
  const whale = rows.slice(0, 12).map(row => row.search(/[▀▄█]/u)).filter(column => column >= 0)
  const title = rows.find(row => row.includes('DeepSeek v1.2.3')) ?? ''
  const titleCenter = title.search(/\S/u) + visibleWidth(title.trim()) / 2
  expect(Math.abs(Math.min(...whale) + 15 - titleCenter)).toBeLessThanOrEqual(3)
  expect(titleCenter).toBeLessThan(120 / 2)
  const alone = plain(renderWelcome(info, 70, 40, 0, new TerminalLocale(), now))
  const aloneTitle = alone.find(row => row.includes('DeepSeek v1.2.3')) ?? ''
  expect(Math.abs(aloneTitle.search(/\S/u) + visibleWidth(aloneTitle.trim()) / 2 - 35)).toBeLessThanOrEqual(1)
})

it('lists featured commands and the first skills as aligned rows, without slashes, and counts the rest', () => {
  const rows = plain(renderWelcome(info, 140, 40, 0, new TerminalLocale(), now))
  const text = rows.join('\n')
  expect(text).toContain('Commands')
  expect(text).toMatch(/ {2}new {5}About new/u)
  expect(text).toMatch(/ {2}resume {2}About resume/u)
  expect(text).not.toContain('About clear')
  expect(text).toContain('+4 more · /help')
  expect(text).toContain('Skills')
  expect(text).toMatch(/dsh-doc {10}Write documentation/u)
  expect(text).toMatch(/ {2}simplify\s*$/mu)
  expect(text).not.toContain('loop')
  expect(text).toContain('+1 more · /skills')
  expect(rows.slice(0, 12).join('\n')).not.toMatch(/\/(new|resume|dsh-doc)\b/u)
  expect(rows.every(row => visibleWidth(row) <= 140)).toBe(true)
})

it('drops descriptions that would not fit, omits empty or unknown skills, and translates headings', () => {
  const tight = plain(renderWelcome({ ...info, skills: [{ name: 'x'.repeat(40), description: 'Too long to show' }] }, 110, 40, 0,
    new TerminalLocale(), now)).join('\n')
  expect(tight).not.toContain('Too long to show')
  expect(tight).toContain('xxxx')
  expect(plain(renderWelcome({ ...info, skills: [] }, 140, 40, 0, new TerminalLocale(), now)).join('\n')).not.toContain('Skills')
  expect(plain(renderWelcome(unknownSkills, 140, 40, 0, new TerminalLocale(), now)).join('\n')).not.toContain('Skills')
  const zh = plain(renderWelcome(info, 140, 40, 0, new TerminalLocale('zh'), now)).join('\n')
  expect(zh).toContain('命令')
  expect(zh).toContain('技能')
  expect(zh).toContain('另有 4 个 · /help')
  expect(zh).toContain('另有 1 个 · /skills')
})

it('shows the whale alone when the lists do not fit beside it', () => {
  const narrow = plain(renderWelcome(info, 70, 40, 0, new TerminalLocale(), now)).join('\n')
  expect(narrow).toMatch(/[▀▄█]/u)
  expect(narrow).not.toContain('Commands')
})

it('translates the continue line', () => {
  expect(plain(renderWelcome(info, 100, 40, 0, new TerminalLocale('zh'), now)).join('\n')).toContain('继续：Fix the queue · 3小时前 · /resume')
})

it('omits absent facts and keeps only the name when nothing else is known', () => {
  expect(plain(renderWelcome({ version: '1', commands: [] }, 100, 40, 0, new TerminalLocale(), now)).filter(row => row.trim() !== '').slice(-1)).toEqual([
    expect.stringContaining('DeepSeek v1')])
})

it('hides the whale in a short or narrow terminal and clips long lines', () => {
  const short = plain(renderWelcome(info, 100, 20, 0, new TerminalLocale(), now)).join('\n')
  expect(short).not.toMatch(/[▀▄█]/u)
  expect(short).not.toContain('Commands')
  expect(plain(renderWelcome(info, 29, 40, 0, new TerminalLocale(), now)).join('\n')).not.toMatch(/[▀▄█]/u)
  const clipped = plain(renderWelcome({ ...info, directory: '/a/very/long/path/that/does/not/fit/in/the/terminal' }, 20, 40, 0, new TerminalLocale(), now))
  expect(clipped.every(row => visibleWidth(row) <= 20)).toBe(true)
  expect(clipped.join('\n')).toContain('terminal')
})

it('describes ages in minutes, hours, and days', () => {
  expect(relativeAge(now - 5 * 60000, 'en', now)).toBe('5 minutes ago')
  expect(relativeAge(now - 90 * 60000, 'en', now)).toBe('2 hours ago')
  expect(relativeAge(now - 3 * 86400000, 'en', now)).toBe('3 days ago')
  expect(relativeAge(now + 60000, 'en', now)).toBe('this minute')
})

it('renders through the component with the current locale and terminal height', () => {
  const locale = new TerminalLocale()
  let rows = 40
  const banner = new WelcomeBanner(locale, () => rows)
  banner.info = info
  expect(plain(banner.render(100)).join('\n')).toMatch(/[▀▄█]/u)
  rows = 10
  expect(plain(banner.render(100)).join('\n')).not.toMatch(/[▀▄█]/u)
  locale.language = 'zh'
  expect(plain(banner.render(100)).join('\n')).toContain('继续：')
  expect(plain(banner.render(0)).length).toBeGreaterThan(0)
  banner.invalidate()
})
