/** File discovery failures are reported once, unless the request was already cancelled. */
import { expect, it, vi } from 'vitest'

const globby = vi.hoisted(() => vi.fn())
vi.mock('globby', () => ({ globby }))

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
