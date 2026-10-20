/** Explicitly named hidden directories complete from the file system, and the transient notice never outlives its request. */
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { ProjectCompletion } from '../src/completion.ts'

async function project(onTestFinished: (callback: () => Promise<void>) => void) {
  const directory = await mkdtemp(join(tmpdir(), 'tui-hidden-'))
  await mkdir(join(directory, '.hidden'))
  await writeFile(join(directory, '.hidden', 'secret.txt'), '')
  await mkdir(join(directory, '.hidden', 'nested'))
  const report = vi.fn()
  const state = vi.fn()
  const completion = new ProjectCompletion(directory, 8, 100, report, state)
  onTestFinished(async () => { await completion.dispose(); await rm(directory, { recursive: true, force: true }) })
  return { completion, report, state, directory }
}

it('lists a named hidden directory and treats a missing one as no matches without an error report', async ({ onTestFinished }) => {
  const { completion, report, state } = await project(onTestFinished)
  const signal = new AbortController().signal
  expect((await completion.getSuggestions(['@.hidden/'], 0, 9, { signal }))?.items.map(item => item.value).sort())
    .toEqual(['@.hidden/nested/', '@.hidden/secret.txt'])
  expect(await completion.getSuggestions(['@.missing/'], 0, 10, { signal })).toBeNull()
  expect(await completion.getSuggestions(['@.hidden/secret.txt/x'], 0, 21, { signal })).toBeNull()
  expect(report).not.toHaveBeenCalled()
  expect(state).toHaveBeenLastCalledWith('No matching project files')
})

it('clears the notice when the cursor leaves an @ reference or the request is aborted', async ({ onTestFinished }) => {
  const { completion, state } = await project(onTestFinished)
  const signal = new AbortController().signal
  await completion.getSuggestions(['@.missing/'], 0, 10, { signal })
  await completion.getSuggestions(['plain'], 0, 5, { signal })
  expect(state).toHaveBeenLastCalledWith('')
  const abort = new AbortController()
  const pending = completion.getSuggestions(['@.hidden/'], 0, 9, { signal: abort.signal })
  abort.abort()
  expect(await pending).toBeNull()
  expect(state).toHaveBeenLastCalledWith('')
})

it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('reports a named directory that exists but cannot be read', async ({ onTestFinished }) => {
  const { completion, report, directory } = await project(onTestFinished)
  const locked = join(directory, '.locked')
  await mkdir(locked)
  await chmod(locked, 0o000)
  try {
    expect(await completion.getSuggestions(['@.locked/'], 0, 9, { signal: new AbortController().signal })).toBeNull()
    expect(report).toHaveBeenCalledWith(expect.stringContaining('File completion unavailable'))
  } finally { await chmod(locked, 0o700) }
})
