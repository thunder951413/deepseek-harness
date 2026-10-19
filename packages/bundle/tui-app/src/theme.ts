/** Terminal-owned colors and Markdown syntax highlighting. */
import { Chalk, type ColorSupportLevel } from 'chalk'
import { highlight, supportsLanguage } from 'cli-highlight'
import type { EditorTheme, MarkdownTheme, SelectListTheme } from '@earendil-works/pi-tui'

/** Respect NO_COLOR while keeping formatting local to this UI. */
export const color = new Chalk({ level: process.env.NO_COLOR === undefined ? 1 : 0 })

/**
 * Estimate the terminal's color depth from its environment.
 * @param env - process environment.
 * @returns 0 for NO_COLOR, 3 for truecolor, 2 for a 256-color terminal, otherwise 1.
 */
export function colorLevel(env: NodeJS.ProcessEnv): ColorSupportLevel {
  if (env.NO_COLOR !== undefined) return 0
  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit') return 3
  return env.TERM?.includes('256color') === true ? 2 : 1
}

/**
 * Build the background painter for the input block.
 * @param hex - `#rrggbb` color; empty disables the background.
 * @param level - terminal color depth; defaults to the current environment's.
 * @returns the painter, or undefined when disabled or the terminal shows no color.
 */
export function inputBackground(hex: string, level = colorLevel(process.env)): ((text: string) => string) | undefined {
  return hex === '' || level === 0 ? undefined : new Chalk({ level }).bgHex(hex)
}

/** Keyboard menu styles shared by the composer and foreground questions. */
export const selectTheme: SelectListTheme = {
  selectedPrefix: color.cyan, selectedText: color.bold, description: color.dim,
  scrollInfo: color.dim, noMatch: () => color.yellow('  No matches'),
}

/** Composer border and suggestion styles. */
export const editorTheme: EditorTheme = { borderColor: color.dim, selectList: selectTheme }

/** Markdown colors; model-provided ANSI sequences are removed before rendering. */
export const markdownTheme: MarkdownTheme = {
  heading: color.bold.cyan, link: color.cyan, linkUrl: color.dim, code: color.yellow,
  codeBlock: text => text, codeBlockBorder: color.dim, quote: color.italic,
  quoteBorder: color.dim, hr: color.dim, listBullet: color.cyan, bold: color.bold,
  italic: color.italic, strikethrough: color.strikethrough, underline: color.underline,
  highlightCode: (code, language) => language !== undefined && supportsLanguage(language)
    ? highlight(code, { language, ignoreIllegals: true }).split('\n') : code.split('\n'),
}
