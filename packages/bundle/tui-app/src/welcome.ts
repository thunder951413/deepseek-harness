/** Start-of-conversation banner: the DeepSeek whale in pixel art, drifting gently, above the session's identity. */
import { Chalk, type ColorSupportLevel } from 'chalk'
import { truncateToWidth, visibleWidth, type Component } from '@earendil-works/pi-tui'
import { fit } from './status-bar.ts'
import { colorLevel } from './theme.ts'
import { terminalText } from './transcript.ts'
import type { Language, Phrase, TerminalLocale } from './locale.ts'

/** One earlier conversation of the invoking directory. */
export interface RecentConversation {
  /** Display title. */
  readonly title: string
  /** Last update, in milliseconds since the epoch. */
  readonly updatedAt: number
}

/** Facts shown under the whale. */
export interface WelcomeInfo {
  /** Terminal package version. */
  readonly version: string
  /** Next request's model and reasoning effort; omitted until the Harness reports it. */
  readonly model?: string
  /** Directory of the selected conversation. */
  readonly directory?: string
  /** Latest titled conversation of this directory, if any. */
  readonly last?: RecentConversation
  /** Local slash commands with their English descriptions. */
  readonly commands: readonly ListEntry[]
  /** Skills a message can invoke; omitted while unknown or when the Harness has none. */
  readonly skills?: readonly ListEntry[]
  /** One line about background maintenance, such as an automatic update; omitted when there is none. */
  readonly notice?: string
}

/** One named command or skill and what it does. */
export interface ListEntry {
  /** Name typed after `/`. */
  readonly name: string
  /** One-line description; empty when none is known. */
  readonly description: string
}

/** The logo, one character per pixel: `b` is the logo blue, `.` is the terminal background. */
const LOGO = [
  '...............b....bb........',
  '.......bbbbbbbbb....bb........',
  '.....bbbbbbbbbbb....bbbb.....b',
  '....bbbbbbbbbbbb....bbbbb.bbbb',
  '..bbbbbbbbbbbbbbb...bbbbbbbbbb',
  '..bbbbbbbbbbbbbbbbb..bbbbbbbbb',
  '.bbbbbbbbbbbbbbbbbbb..bbbbbbb.',
  '.bbbbbbbbbbbbbbbbbbb..bbbbbb..',
  'bbb...bbbbbbbbbbbbbbbbbbbb....',
  'bbb......bbbbbbbb.bbbbbbb.....',
  'bbb.......bbbbbbbb.bbbbbb.....',
  'bbb........bbbbbbb..bbbbb.....',
  'bbbb........bbbbbb..bbbbb.....',
  '.bbb.........bbbbbbbbbbb......',
  '.bbbb.........bbbbbbbbbb......',
  '.bbbb.........bbbbbbbbb.......',
  '..bbbb....bb...bbbbbbbb.......',
  '...bbbb...bbbb..bbbbbb........',
  '....bbbbbbbbbbb..bbbbbbb......',
  '.....bbbbbbbbbbbbbbbbbbb......',
  '......bbbbbbbbbbbb..bbb.......',
  '........bbbbbbbb..............',
] as const

const LOGO_WIDTH = 30
/** Pixel rows the whale drifts down at the lowest point of its bob; one bob takes `2 * BOB_RANGE` frames. */
const BOB_RANGE = 2
/** Terminal rows below which the whale is hidden so the conversation keeps room. */
const WHALE_MIN_ROWS = 26
/** Logo blue; drawn with whatever color depth the terminal supports. */
const BLUE = '#6185f6'
/** Columns between the left area and the lists, and the least room kept around the whale. */
const GAP = 4
/** Blank columns right of the lists. */
const RIGHT_MARGIN = 2
/** Widest and narrowest list pane; a narrower terminal shows the whale alone. */
const PANE_MAX = 56
const PANE_MIN = 28
/** Commands worth knowing first, in display order; `/help` lists the rest. */
const FEATURED_COMMANDS = ['new', 'resume', 'model', 'tools'] as const
/** Skills listed beside the whale; `/skills` lists the rest. */
const SKILL_ROWS = 3
/** Narrowest description worth showing beside a name. */
const DESCRIPTION_MIN = 12

/**
 * Describe how long ago a time was.
 * @param updatedAt - milliseconds since the epoch.
 * @param language - interface language.
 * @param now - current milliseconds since the epoch.
 * @returns a relative phrase in minutes, hours, or days; times in the future read as now.
 */
export function relativeAge(updatedAt: number, language: Language, now = Date.now()): string {
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })
  const minutes = Math.max(0, Math.round((now - updatedAt) / 60000))
  if (minutes < 60) return format.format(-minutes, 'minute')
  return minutes < 1440 ? format.format(-Math.round(minutes / 60), 'hour') : format.format(-Math.round(minutes / 1440), 'day')
}

/**
 * Draw one animation frame of the whale with half-block characters, two pixel rows per text row.
 * @param frame - animation counter; the whale bobs one pixel at a time and repeats every four frames.
 * @param level - terminal color depth; 0 draws the silhouette without color.
 * @returns the rows, each exactly `LOGO_WIDTH` columns wide; the row count does not change between frames.
 */
export function whaleRows(frame: number, level = colorLevel(process.env)): string[] {
  const paint = new Chalk({ level }).hex(BLUE)
  const blank = '.'.repeat(LOGO_WIDTH)
  const phase = frame % (2 * BOB_RANGE)
  const above = phase <= BOB_RANGE ? phase : 2 * BOB_RANGE - phase
  const pixels = [...Array.from({ length: above }, () => blank), ...LOGO, ...Array.from({ length: BOB_RANGE - above }, () => blank)]
  return Array.from({ length: pixels.length / 2 }, (_unused, row) => paint(Array.from({ length: LOGO_WIDTH }, (_cell, column) => {
    const top = pixels[row * 2]?.[column] === 'b'
    const bottom = pixels[row * 2 + 1]?.[column] === 'b'
    return top ? (bottom ? '█' : '▀') : (bottom ? '▄' : ' ')
  }).join('')))
}

function center(text: string, width: number): string {
  const clipped = truncateToWidth(text, width)
  return `${' '.repeat(Math.floor(Math.max(0, width - visibleWidth(clipped)) / 2))}${clipped}`
}

function pad(text: string, width: number): string {
  const clipped = truncateToWidth(text, width)
  return `${clipped}${' '.repeat(Math.max(0, width - visibleWidth(clipped)))}`
}

/** A heading over indented `name  description` rows (names alone when descriptions would not fit),
 * then how many more there are and where to see them. */
function list(heading: string, entries: readonly ListEntry[], total: number, more: Phrase, width: number,
  locale: TerminalLocale, level: ColorSupportLevel): string[] {
  const color = new Chalk({ level })
  const named = entries.map(entry => ({ name: terminalText(entry.name), description: terminalText(entry.description) }))
  const key = Math.max(0, ...named.map(entry => visibleWidth(entry.name)))
  const room = width - 2 - key - 2
  const rows = named.map(({ name, description }) => `  ${room < DESCRIPTION_MIN || description === ''
    ? truncateToWidth(name, width - 2, '…')
    : `${pad(name, key)}  ${color.dim(truncateToWidth(description, room, '…'))}`}`)
  const hidden = total - entries.length
  return [color.hex(BLUE).bold(heading), ...rows,
    ...hidden <= 0 ? [] : [color.dim(`  ${locale.text(more, { count: hidden })}`)]]
}

/**
 * Lay out the banner for one terminal size.
 * @param info - identity, the last conversation, commands, and skills.
 * @param width - terminal width in columns.
 * @param rows - terminal height; a short terminal omits the whale and the lists.
 * @param frame - animation counter.
 * @param locale - terminal interface language.
 * @param now - current milliseconds since the epoch, for the relative time.
 * @returns rows each at most `width` columns wide. Featured commands and the first skills sit at the right when they fit;
 * the whale, then the name and version, model, directory, and how to continue the last conversation are centered in the
 * columns left of them, or across the whole width without them, followed by any maintenance notice.
 */
export function renderWelcome(info: WelcomeInfo, width: number, rows: number, frame: number,
  locale: TerminalLocale, now = Date.now()): string[] {
  const level = colorLevel(process.env)
  const color = new Chalk({ level })
  const tall = rows >= WHALE_MIN_ROWS
  const art = tall && width >= LOGO_WIDTH ? whaleRows(frame) : []
  const pane = Math.min(PANE_MAX, width - LOGO_WIDTH - 3 * GAP - RIGHT_MARGIN)
  const featured = FEATURED_COMMANDS.flatMap(name => info.commands.filter(command => command.name === name))
    .map(command => ({ name: command.name, description: locale.description(command.description) }))
  const skills = info.skills ?? []
  const side = art.length === 0 || pane < PANE_MIN ? [] : [
    ...list(locale.text('Commands'), featured, info.commands.length, '+{count} more · /help', pane, locale, level),
    ...skills.length === 0 ? [] : ['', ...list(locale.text('Skills'), skills.slice(0, SKILL_ROWS), skills.length,
      '+{count} more · /skills', pane, locale, level)],
  ]
  const used = Math.max(0, ...side.map(row => visibleWidth(row)))
  const area = side.length === 0 ? width : width - used - GAP - RIGHT_MARGIN
  const whale = art.map(row => center(row, area))
  const last = info.last === undefined ? []
    : [center(color.dim(locale.text('Continue: {title} · {age} · /resume', { title: terminalText(info.last.title),
      age: relativeAge(info.last.updatedAt, locale.language, now) })), area)]
  return [...whale.map((row, index) => side[index] === undefined ? row : `${pad(row, area)}${' '.repeat(GAP)}${side[index]}`),
    ...art.length === 0 ? [] : [''],
    center(`${color.bold('DeepSeek')}${color.dim(` v${terminalText(info.version)}`)}`, area),
    ...info.model === undefined ? [] : [center(color.dim(terminalText(info.model)), area)],
    ...info.directory === undefined ? [] : [center(color.dim(fit({ text: terminalText(info.directory), keep: 'end' }, area)), area)],
    ...last, ...info.notice === undefined ? [] : [center(color.yellow(terminalText(info.notice)), area)], '']
}

/** Component that draws the banner above the conversation. */
export class WelcomeBanner implements Component {
  /** Animation counter; the owner advances it while the banner is animating. */
  frame = 0
  /** Current facts. */
  info: WelcomeInfo = { version: '', commands: [] }

  /**
   * @param locale - terminal interface language, read at every render.
   * @param rows - current terminal height, read at every render.
   */
  constructor(private readonly locale: TerminalLocale, private readonly rows: () => number) {}

  /** @param width - available columns.
   * @returns the banner rows. */
  render(width: number): string[] { return renderWelcome(this.info, Math.max(1, width), this.rows(), this.frame, this.locale) }

  /** The banner holds no cached layout. */
  invalidate(): void {}
}
