/** Project-local path discovery and slash-command completion. */
import { readdir, type Dirent } from 'node:fs'
import { basename, resolve } from 'node:path'
import { convertPathToPattern, globby, isIgnoredByIgnoreFiles } from 'globby'
import { CombinedAutocompleteProvider, fuzzyFilter, type AutocompleteProvider, type SlashCommand } from '@earendil-works/pi-tui'

/** Human commands handled locally without sending their text to a model. */
export const terminalCommands: SlashCommand[] = [
  { name: 'new', description: 'Start a conversation in this directory' },
  { name: 'clear', description: 'Start a fresh conversation (same as /new)' },
  { name: 'resume', description: 'Find and resume a conversation' },
  { name: 'model', description: 'Choose the next model' },
  { name: 'reasoning', description: 'Choose reasoning effort' },
  { name: 'stats', description: 'Show complete usage and balance' },
  { name: 'cost', description: 'Show complete usage and balance (same as /stats)' },
  { name: 'web', description: 'Show the browser sign-in link' },
  { name: 'tools', description: 'Inspect tool arguments and output' },
  { name: 'help', description: 'Show commands and keyboard shortcuts' },
  { name: 'exit', description: 'Close this terminal and its Web service' },
]

/** Owns an abortable file index and all outstanding completion requests. */
export class ProjectCompletion implements AutocompleteProvider {
  readonly triggerCharacters = ['/', '@']
  private readonly lifetime = new AbortController()
  private readonly requests = new Set<Promise<unknown>>()
  private files: Promise<string[]> | undefined
  private generation = 0
  private provider: CombinedAutocompleteProvider

  /**
   * @param directory - directory of the selected Session.
   * @param depth - maximum project traversal depth.
   * @param limit - maximum indexed file paths.
   * @param report - visible failure or partial-index reporter; failed discovery is retryable.
   */
  constructor(private directory: string, private readonly depth: number, private readonly limit: number,
    private readonly report: (message: string) => void) {
    this.provider = new CombinedAutocompleteProvider(terminalCommands, directory)
  }

  /** Set the selected Session's directory and discard its old file index.
   * @param directory - current Session directory. */
  setDirectory(directory: string): void {
    this.directory = directory
    this.provider = new CombinedAutocompleteProvider(terminalCommands, directory)
    this.refresh()
  }

  /** Re-read project paths on the next request after tools may have changed files. */
  refresh(): void { this.files = undefined; this.generation++ }

  /**
   * Complete local commands or insert a quoted project path after `@`; hidden directories are not scanned.
   * Unreadable child directories are skipped with a partial-results notice; other discovery failures report no suggestions.
   * @param args - editor lines, logical cursor position, and cancellation or explicit-completion state.
   * @returns suggestions, or null after cancellation or a reported discovery failure.
   */
  getSuggestions(...args: Parameters<AutocompleteProvider['getSuggestions']>): ReturnType<AutocompleteProvider['getSuggestions']> {
    const task = this.suggestions(...args)
    this.requests.add(task)
    void task.finally(() => { this.requests.delete(task) })
    return task
  }

  private cancelled(signal: AbortSignal, generation: number): boolean {
    return this.lifetime.signal.aborted || signal.aborted || generation !== this.generation
  }

  private async discover(signal: AbortSignal, generation: number): Promise<string[]> {
    const directory = resolve(this.directory)
    const skipped = new Set<string>()
    const finish = <T>(path: string, error: NodeJS.ErrnoException | null, files: T[],
      callback: (error: NodeJS.ErrnoException | null, files: T[]) => void): void => {
      if (error !== null && (error.code === 'EPERM' || error.code === 'EACCES') && resolve(path) !== directory) {
        skipped.add(path)
        callback(null, [])
      } else callback(error, files)
    }
    type ReadCallback<T> = (error: NodeJS.ErrnoException | null, files: T[]) => void
    function readDirectory(...args: [string, ReadCallback<string>] | [string, { withFileTypes: true }, ReadCallback<Dirent>]): void {
      if (args.length === 2) readdir(args[0], (error, files) => { finish(args[0], error, files, args[1]) })
      else readdir(args[0], args[1], (error, files) => { finish(args[0], error, files, args[2]) })
    }
    // Discover rule files in the same permission-aware walk; globby's gitignore walk does not use its fs adapter.
    const paths = await globby('**/*', { cwd: directory, dot: true, fs: { readdir: readDirectory },
      onlyFiles: true, followSymbolicLinks: false, deep: this.depth,
      ignore: ['**/node_modules/**', '**/.!(gitignore)/**'] })
    const rules = paths.filter(path => basename(path) === '.gitignore')
    const ignored = await isIgnoredByIgnoreFiles(rules.map(convertPathToPattern), { cwd: directory })
    const files = paths.filter(path => basename(path) !== '.gitignore' && !ignored(path)).sort().slice(0, this.limit)
    if (skipped.size > 0 && !this.cancelled(signal, generation)) {
      this.report(`File completion is partial: skipped ${skipped.size} unreadable ${skipped.size === 1 ? 'directory' : 'directories'}. Enter a file path manually if needed.`)
    }
    return files
  }

  private async suggestions(...[lines, cursorLine, cursorCol, options]: Parameters<AutocompleteProvider['getSuggestions']>) {
    const generation = this.generation
    if (this.cancelled(options.signal, generation)) return null
    const before = (lines[cursorLine] ?? '').slice(0, cursorCol)
    const prefix = /(?:^|\s)(@"[^"]*|@[^\s"]*)$/u.exec(before)?.[1]
    try {
      if (prefix === undefined) {
        const suggestions = await this.provider.getSuggestions(lines, cursorLine, cursorCol, options)
        return this.cancelled(options.signal, generation) ? null : suggestions
      }
      const files = await (this.files ??= this.discover(options.signal, generation))
      if (this.cancelled(options.signal, generation)) return null
      const query = prefix.replace(/^@"?/u, '')
      const items = fuzzyFilter(files, query, path => path).map(path => ({
        value: /\s|["\u0000-\u001f\u007f-\u009f]/u.test(path) ? `@${JSON.stringify(path)}` : `@${path}`,
        label: /[\u0000-\u001f\u007f-\u009f]/u.test(path) ? JSON.stringify(path) : path,
      }))
      return items.length === 0 ? null : { items, prefix }
    } catch (error) {
      if (!this.cancelled(options.signal, generation)) {
        this.files = undefined
        this.report(`File completion unavailable: ${error instanceof Error ? error.message : String(error)}. Type @ to retry.`)
      }
      return null
    }
  }

  /** Apply completion using the editor library's path quoting and cursor rules.
   * @param args - editor state and selected suggestion.
   * @returns updated editor text and cursor. */
  applyCompletion(...args: Parameters<AutocompleteProvider['applyCompletion']>): ReturnType<AutocompleteProvider['applyCompletion']> {
    return this.provider.applyCompletion(...args)
  }

  /** Cancel publication and await filesystem work before releasing the UI.
   * @returns after every outstanding request has settled. */
  async dispose(): Promise<void> {
    this.lifetime.abort()
    await Promise.allSettled(this.requests)
  }
}
