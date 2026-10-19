/** Terminal-owned colors and Markdown syntax highlighting. */
import { Chalk } from 'chalk'
import { highlight, supportsLanguage } from 'cli-highlight'
import type { EditorTheme, MarkdownTheme, SelectListTheme } from '@earendil-works/pi-tui'

/** Respect NO_COLOR while keeping formatting local to this UI. */
export const color = new Chalk({ level: process.env.NO_COLOR === undefined ? 1 : 0 })

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
