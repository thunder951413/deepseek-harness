/** The owned backend process starts, reports, times out, and closes without leaking its token. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { startServer } from '../src/server.ts'

const originalBin = process.argv[1]
afterEach(() => { process.argv[1] = originalBin as string })

async function backend(mode: 'ready' | 'exit' | 'silent', onTestFinished: (cleanup: () => Promise<void>) => void): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'tui-server-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  const script = join(root, 'backend.mjs')
  await writeFile(script, `
const mode = ${JSON.stringify(mode)}
process.on('SIGTERM', () => { console.log('closing'); process.exit(0) })
if (mode === 'exit') process.exit(3)
if (mode === 'ready') {
  console.error('warning https://x.test/?token=secret&a=1')
  console.log('plain line')
  console.log('')
  console.log('dsh web: http://127.0.0.1:4321/?token=abc')
}
setInterval(() => {}, 1000)
`)
  process.argv[1] = script
}

it('returns the authenticated URL, forwards redacted diagnostics, and closes the child once', async ({ onTestFinished }) => {
  await backend('ready', onTestFinished)
  const report = vi.fn<(text: string) => void>()
  const server = await startServer('web', 0, 10000, 1000, new AbortController().signal, report)
  expect(server.url).toBe('http://127.0.0.1:4321/?token=abc')
  await expect.poll(() => report.mock.calls.flat()).toContain('warning https://x.test/?token=[redacted]&a=1')
  expect(report.mock.calls.flat().join('\n')).not.toContain('secret')
  await Promise.all([server.close(), server.close()])
})

it('closes the child when the terminal lifetime is aborted', async ({ onTestFinished }) => {
  await backend('ready', onTestFinished)
  const abort = new AbortController()
  const report = vi.fn<(text: string) => void>()
  const server = await startServer('web', 0, 10000, 1000, abort.signal, report)
  abort.abort()
  await expect.poll(() => report.mock.calls.flat()).toContain('closing')
  await server.close()
})

it('reports a backend that exits before it is ready', async ({ onTestFinished }) => {
  await backend('exit', onTestFinished)
  await expect(startServer('web', 0, 10000, 1000, new AbortController().signal, vi.fn())).rejects.toThrow('exited before startup (3)')
})

it('stops a backend that never reports readiness', async ({ onTestFinished }) => {
  await backend('silent', onTestFinished)
  await expect(startServer('web', 0, 100, 1000, new AbortController().signal, vi.fn())).rejects.toThrow('startup timed out')
})

it('reports a backend that cannot be launched', async ({ onTestFinished }) => {
  await backend('ready', onTestFinished)
  const original = process.execPath
  Object.defineProperty(process, 'execPath', { value: '/nonexistent/node', configurable: true })
  try {
    await expect(startServer('web', 0, 10000, 1000, new AbortController().signal, vi.fn())).rejects.toThrow('exited before startup (unknown)')
  } finally { Object.defineProperty(process, 'execPath', { value: original, configurable: true }) }
})

it('refuses to start when already cancelled or when there is no launcher entry', async ({ onTestFinished }) => {
  await backend('ready', onTestFinished)
  const abort = new AbortController()
  abort.abort()
  await expect(startServer('web', 0, 10000, 1000, abort.signal, vi.fn())).rejects.toThrow()
  process.argv.length = 1
  await expect(startServer('web', 0, 10000, 1000, new AbortController().signal, vi.fn())).rejects.toThrow('through a dsh profile')
})
