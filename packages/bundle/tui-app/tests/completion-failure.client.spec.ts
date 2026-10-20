/** File discovery failures are reported once, unless the request was already cancelled. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'

const globby = vi.hoisted(() => vi.fn())
vi.mock('globby', () => ({ globby, convertPathToPattern: (path: string) => path, isIgnoredByIgnoreFiles: async () => () => false }))

const { ProjectCompletion } = await import('../src/completion.ts')

it('reports a thrown value that is not an Error and stays quiet after cancellation', async ({ onTestFinished }) => {
  const report = vi.fn()
  const completion = new ProjectCompletion('/project', 8, 100, report)
  onTestFinished(async () => { await completion.dispose() })
  globby.mockRejectedValueOnce('disk offline')
  expect(await completion.getSuggestions(['@'], 0, 1, { signal: new AbortController().signal })).toBeNull()
  expect(report).toHaveBeenCalledWith('File completion unavailable: disk offline. Type @ to retry.')
  const abort = new AbortController()
  globby.mockImplementationOnce(async () => { abort.abort(); throw new Error('late') })
  expect(await completion.getSuggestions(['@'], 0, 1, { signal: abort.signal })).toBeNull()
  expect(report).toHaveBeenCalledTimes(1)
})

it('serves directory reads that the walker requests without file types', async ({ onTestFinished }) => {
  const root = await mkdtemp(join(tmpdir(), 'tui-readdir-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  await writeFile(join(root, 'plain.txt'), '')
  type ReadDirectory = (path: string, done: (error: Error | null, files: string[]) => void) => void
  globby.mockImplementationOnce(async (_pattern: string, options: { fs: { readdir: ReadDirectory } }) =>
    new Promise<string[]>((resolve, reject) => {
      options.fs.readdir(root, (error, files) => { if (error === null) resolve(files); else reject(error) })
    }))
  const completion = new ProjectCompletion(root, 8, 100, vi.fn())
  onTestFinished(async () => { await completion.dispose() })
  expect((await completion.getSuggestions(['@'], 0, 1, { signal: new AbortController().signal }))?.items.map(item => item.label)).toEqual(['plain.txt'])
})
