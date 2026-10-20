/** Height-bounded reading and search for long terminal content, independent of native scrollback. */
import { Input, Markdown, Text, matchesKey, truncateToWidth, type Component, type Focusable } from '@earendil-works/pi-tui'
import { stripVTControlCharacters } from 'node:util'
import { color, markdownTheme } from './theme.ts'
import { terminalText } from './transcript.ts'
import type { TerminalLocale } from './locale.ts'

/** Scrollable detail document with literal text search and resize-safe scroll offsets. */
export class DetailView implements Component, Focusable {
  focused = false
  private readonly body: Component
  private readonly search = new Input()
  private searching = false
  private query = ''
  private offset = 0
  private height = 1
  private lines: string[] = []
  private matches: number[] = []
  private match = -1

  /**
   * @param title - plain-text heading.
   * @param text - sanitized document content.
   * @param rows - current terminal height, read again on resize.
   * @param locale - owning terminal language.
   * @param close - dismiss without changing the composer.
   * @param markdown - render Markdown when true; false preserves tool-output text.
   */
  constructor(private readonly title: string, text: string, private readonly rows: () => number,
    private readonly locale: TerminalLocale, private readonly close: () => void, markdown = false) {
    this.body = markdown ? new Markdown(terminalText(text), 0, 0, markdownTheme) : new Text(terminalText(text), 0, 0)
  }

  /** Invalidate wrapped content after terminal changes. */
  invalidate(): void { this.body.invalidate() }

  /** @param width - available columns.
   * @returns a heading, visible document rows, and reading/search controls. */
  render(width: number): string[] {
    this.height = Math.max(1, this.rows() - 10)
    this.lines = this.body.render(Math.max(1, width))
    this.findMatches()
    this.offset = Math.max(0, Math.min(this.offset, Math.max(0, this.lines.length - this.height)))
    const position = `${this.offset + 1}–${Math.min(this.offset + this.height, this.lines.length)}/${this.lines.length}`
    const search = this.searching ? this.search.render(width) : [
      color.dim(truncateToWidth(`${position} · ${this.locale.text('↑↓ scroll · PgUp/PgDn page · / search · n/N next/previous · Esc back')}`, width)),
    ]
    const result = this.query === '' ? [] : [truncateToWidth(this.matches.length === 0 ? this.locale.text('No matches')
      : `${this.match + 1}/${this.matches.length} · ${this.query}`, width)]
    return [truncateToWidth(color.bold(terminalText(this.title)), width),
      ...this.lines.slice(this.offset, this.offset + this.height), ...result, ...search]
  }

  /** @param data - raw terminal keyboard sequence. */
  handleInput(data: string): void {
    if (this.searching) {
      if (matchesKey(data, 'escape')) { this.searching = false; this.search.focused = false; return }
      if (matchesKey(data, 'enter')) { this.searching = false; this.search.focused = false; this.jump(1); return }
      this.search.handleInput(data)
      this.query = this.search.getValue()
      this.match = -1
      this.findMatches()
      return
    }
    if (matchesKey(data, 'escape') || matchesKey(data, 'enter')) this.close()
    else if (data === '/') { this.searching = true; this.search.focused = true; this.search.setValue(this.query) }
    else if (data === 'n') this.jump(1)
    else if (data === 'N') this.jump(-1)
    else if (matchesKey(data, 'up')) this.offset--
    else if (matchesKey(data, 'down')) this.offset++
    else if (matchesKey(data, 'pageUp')) this.offset -= this.height
    else if (matchesKey(data, 'pageDown') || data === ' ') this.offset += this.height
    else if (matchesKey(data, 'home')) this.offset = 0
    else if (matchesKey(data, 'end')) this.offset = this.lines.length
  }

  private findMatches(): void {
    this.matches = this.query === '' ? [] : this.lines.flatMap((line, index) =>
      stripVTControlCharacters(line).toLocaleLowerCase().includes(this.query.toLocaleLowerCase()) ? [index] : [])
  }

  private jump(direction: number): void {
    if (this.matches.length === 0) return
    this.match = this.match < 0 ? (direction > 0 ? 0 : this.matches.length - 1)
      : (this.match + direction + this.matches.length) % this.matches.length
    this.offset = this.matches[this.match] ?? 0
  }
}
