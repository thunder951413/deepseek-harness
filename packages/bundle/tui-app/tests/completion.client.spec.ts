/** Project completion uses owned directories and waits for discovery during disposal. */
import { chmod, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { ProjectCompletion } from '../src/completion.ts'

it('finds nested project files, respects ignored paths, and quotes spaces', async ({ onTestFinished }) => {
  const root = await mkdtemp(join(tmpdir(), 'tui-files-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  await mkdir(join(root, 'docs'))
  await mkdir(join(root, 'node_modules'))
  await writeFile(join(root, 'docs', '中文 note.md'), 'note')
  await writeFile(join(root, 'ignored.txt'), 'ignored')
  await writeFile(join(root, 'node_modules', 'hidden.ts'), 'hidden')
  await writeFile(join(root, '.gitignore'), 'ignored.txt\n')
  const report = vi.fn()
  const completion = new ProjectCompletion(root, 8, 100, report)
  onTestFinished(async () => { await completion.dispose() })
  const options = { signal: new AbortController().signal }
  const result = await completion.getSuggestions(['read @中文'], 0, 8, options)
  expect(result?.items).toEqual([{ value: '@"docs/中文 note.md"', label: 'docs/中文 note.md' }])
  const item = result?.items[0]
  if (result === null || item === undefined) throw new Error('Expected project suggestion')
  expect(completion.applyCompletion(['read @中文'], 0, 8, item, result.prefix)).toEqual({
    lines: ['read @"docs/中文 note.md" '], cursorLine: 0, cursorCol: 24,
  })
  expect((await completion.getSuggestions(['@'], 0, 1, options))?.items.map(item => item.label)).toEqual(['docs/中文 note.md'])
  expect(report).not.toHaveBeenCalled()
})

// POSIX directory permissions are not enforced on Windows or for root.
it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
  'completes visible files without scanning unreadable hidden directories for gitignore files', async ({ onTestFinished }) => {
    const root = await mkdtemp(join(tmpdir(), 'tui-hidden-'))
    onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
    const trash = join(root, '.Trash')
    await mkdir(trash)
    onTestFinished(async () => { await chmod(trash, 0o700) })
    await writeFile(join(trash, '.gitignore'), '*\n')
    await mkdir(join(root, 'docs'))
    await writeFile(join(root, '.gitignore'), 'root-ignored.txt\n')
    await writeFile(join(root, 'root-ignored.txt'), '')
    await writeFile(join(root, 'docs', '.gitignore'), 'nested-ignored.txt\n')
    await writeFile(join(root, 'docs', 'nested-ignored.txt'), '')
    await writeFile(join(root, 'docs', 'visible.txt'), '')
    await chmod(trash, 0)
    const report = vi.fn()
    const completion = new ProjectCompletion(root, 8, 100, report)
    onTestFinished(async () => { await completion.dispose() })
    const result = await completion.getSuggestions(['@'], 0, 1, { signal: new AbortController().signal })
    expect(result?.items.map(item => item.label)).toEqual(['docs/visible.txt'])
    expect(report).not.toHaveBeenCalled()
  },
)

// POSIX directory permissions are not enforced on Windows or for root.
it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
  'keeps readable suggestions when a visible subtree is inaccessible, but reports an inaccessible root', async ({ onTestFinished }) => {
    const root = await mkdtemp(join(tmpdir(), 'tui-permissions-'))
    onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
    const blocked = join(root, 'Library', 'Accounts')
    await mkdir(blocked, { recursive: true })
    onTestFinished(async () => { await chmod(blocked, 0o700) })
    await writeFile(join(root, 'visible.txt'), '')
    await writeFile(join(root, '.gitignore'), 'ignored.txt\n')
    onTestFinished(async () => { await chmod(join(root, '.gitignore'), 0o600) })
    await writeFile(join(root, 'ignored.txt'), '')
    await chmod(blocked, 0)
    const report = vi.fn()
    const completion = new ProjectCompletion(root, 8, 100, report)
    onTestFinished(async () => { await completion.dispose() })
    const options = { signal: new AbortController().signal }
    expect((await completion.getSuggestions(['@'], 0, 1, options))?.items.map(item => item.label)).toEqual(['visible.txt'])
    expect(report).toHaveBeenCalledWith('File completion is partial: skipped 1 unreadable directory. Enter a file path manually if needed.')
    await completion.getSuggestions(['@visible'], 0, 8, options)
    expect(report).toHaveBeenCalledTimes(1)
    completion.setDirectory(blocked)
    expect(await completion.getSuggestions(['@'], 0, 1, options)).toBeNull()
    expect(report).toHaveBeenLastCalledWith(expect.stringContaining('File completion unavailable'))
    await chmod(join(root, '.gitignore'), 0)
    completion.setDirectory(root)
    expect(await completion.getSuggestions(['@'], 0, 1, options)).toBeNull()
    expect(report).toHaveBeenLastCalledWith(expect.stringContaining('.gitignore'))
  },
)

it('completes slash commands and keeps discovery bounded to the selected directory', async ({ onTestFinished }) => {
  const root = await mkdtemp(join(tmpdir(), 'tui-commands-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  await mkdir(join(root, 'next'))
  await writeFile(join(root, 'first.txt'), '')
  await writeFile(join(root, 'next', 'second.txt'), '')
  const completion = new ProjectCompletion(root, 1, 1, vi.fn())
  onTestFinished(async () => { await completion.dispose() })
  const options = { signal: new AbortController().signal }
  expect((await completion.getSuggestions(['/res'], 0, 4, options))?.items.map(item => item.value)).toContain('resume')
  expect((await completion.getSuggestions(['@'], 0, 1, options))?.items).toHaveLength(1)
  completion.refresh()
  const old = completion.getSuggestions(['@'], 0, 1, options)
  completion.setDirectory(join(root, 'next'))
  expect(await old).toBeNull()
  expect((await completion.getSuggestions(['@'], 0, 1, options))?.items.map(item => item.value)).toEqual(['@second.txt'])
})

it('discards an in-flight file result after disposal', async ({ onTestFinished }) => {
  const root = await mkdtemp(join(tmpdir(), 'tui-completion-stop-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  await writeFile(join(root, 'file.txt'), '')
  const completion = new ProjectCompletion(root, 8, 100, vi.fn())
  const request = completion.getSuggestions(['@'], 0, 1, { signal: new AbortController().signal })
  await completion.dispose()
  expect(await request).toBeNull()
  expect(await completion.getSuggestions(['/'], 0, 1, { signal: new AbortController().signal })).toBeNull()
})

it('quotes control characters, reports no match, and drops results cancelled during discovery', async ({ onTestFinished }) => {
  const root = await mkdtemp(join(tmpdir(), 'tui-quote-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  await writeFile(join(root, 'tab\there.txt'), '')
  await writeFile(join(root, 'plain.txt'), '')
  const completion = new ProjectCompletion(root, 8, 100, vi.fn())
  onTestFinished(async () => { await completion.dispose() })
  const options = { signal: new AbortController().signal }
  const quoted = await completion.getSuggestions(['@tab'], 0, 4, options)
  expect(quoted?.items).toEqual([{ value: '@"tab\\there.txt"', label: '"tab\\there.txt"' }])
  expect(await completion.getSuggestions(['@zzzzqq'], 0, 7, options)).toBeNull()
  expect(await completion.getSuggestions([], 3, 0, options)).toBeNull()
  const abort = new AbortController()
  const pending = completion.getSuggestions(['/he'], 0, 3, { signal: abort.signal })
  abort.abort()
  expect(await pending).toBeNull()
  const later = new AbortController()
  const files = completion.getSuggestions(['@plain'], 0, 6, { signal: later.signal })
  later.abort()
  expect(await files).toBeNull()
})

it('reports unreadable project directories and retries on the next request', async ({ onTestFinished }) => {
  const root = await mkdtemp(join(tmpdir(), 'tui-broken-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  const file = join(root, 'not-a-directory')
  await writeFile(file, '')
  const report = vi.fn()
  const completion = new ProjectCompletion(file, 8, 100, report)
  onTestFinished(async () => { await completion.dispose() })
  expect(await completion.getSuggestions(['@'], 0, 1, { signal: new AbortController().signal })).toBeNull()
  expect(report).toHaveBeenCalledWith(expect.stringContaining('File completion unavailable'))
  completion.setDirectory(root)
  expect((await completion.getSuggestions(['@'], 0, 1, { signal: new AbortController().signal }))?.items.map(item => item.label)).toEqual(['not-a-directory'])
})

it('lists an explicitly named hidden directory and reports empty searches independently', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tui-explicit-'))
  const state = vi.fn()
  const report = vi.fn()
  const completion = new ProjectCompletion(root, 2, 100, report, state)
  try {
    await mkdir(join(root, '.config'))
    await writeFile(join(root, '.config', 'settings.json'), '{}')
    const options = { signal: new AbortController().signal }
    expect(await completion.getSuggestions(['@settings'], 0, 9, options)).toBeNull()
    expect(state).toHaveBeenLastCalledWith('No matching project files')
    const query = '@.config/set'
    expect((await completion.getSuggestions([query], 0, query.length, options))?.items.map(item => item.label))
      .toEqual(['.config/settings.json'])
    expect(state).toHaveBeenLastCalledWith('')
    expect(report).not.toHaveBeenCalled()
  } finally { await completion.dispose(); await rm(root, { recursive: true, force: true }) }
})

it('offers Harness commands and skills after the terminal commands without letting them take a terminal name', async ({ onTestFinished }) => {
  const root = await mkdtemp(join(tmpdir(), 'tui-commands-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  const completion = new ProjectCompletion(root, 8, 100, vi.fn())
  onTestFinished(async () => { await completion.dispose() })
  completion.setExtraCommands([{ name: 'compact', description: 'Compact context' }, { name: 'model', description: 'Host model' },
    { name: 'dsh-doc', description: 'Skill · Write docs' }])
  const options = { signal: new AbortController().signal }
  const items = (await completion.getSuggestions(['/'], 0, 1, options))?.items ?? []
  expect(items.find(item => item.value === 'compact')?.description).toBe('Compact context')
  expect(items.find(item => item.value === 'dsh-doc')?.description).toBe('Skill · Write docs')
  expect(items.filter(item => item.value === 'model')).toHaveLength(1)
  expect(items.find(item => item.value === 'model')?.description).not.toBe('Host model')
  expect(completion.isCommand(' /compact ')).toBe(true)
  expect(completion.isCommand('/new')).toBe(true)
  expect(completion.isCommand('/compact now')).toBe(false)
  expect(completion.isCommand('compact')).toBe(false)
  completion.setDirectory(root)
  expect(completion.isCommand('/dsh-doc')).toBe(true)
})
