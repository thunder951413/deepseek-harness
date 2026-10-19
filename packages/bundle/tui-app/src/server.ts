/** Start a stock dsh Web profile and own only that subprocess. */
import { execa } from 'execa'

/** A Web listener started for one terminal lifetime. */
export interface TerminalServer {
  /** Authenticated launch URL, kept within this process. */
  readonly url: string
  /** Gracefully close the owned Harness process.
   * @returns after the child has exited. */
  close(): Promise<void>
}

/** Start the invoking CLI's Web profile without modifying its installation.
 * @param profile - backend profile with the ordinary base and Web bundles.
 * @param port - requested listener port; zero asks the operating system.
 * @param timeoutMs - startup deadline.
 * @param shutdownMs - maximum graceful shutdown interval.
 * @param signal - terminal lifetime.
 * @param report - bounded backend diagnostics without launch tokens.
 * @returns a ready listener and its owned shutdown operation. */
export async function startServer(profile: string, port: number, timeoutMs: number, shutdownMs: number,
  signal: AbortSignal, report: (text: string) => void): Promise<TerminalServer> {
  const bin = process.argv[1]
  if (bin === undefined) throw new Error('The terminal must be started through a dsh profile')
  const child = execa(process.execPath, [...process.execArgv, bin, '--profile', profile, '--no-open', '--port', String(port)], {
    stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', reject: false, forceKillAfterDelay: shutdownMs,
  })
  const ready = Promise.withResolvers<string>()
  // A rejection after an early abort has no awaiting consumer; the await below observes it otherwise.
  ready.promise.catch((_error: unknown) => {})

  let closing: Promise<void> | undefined
  const close = (): Promise<void> => closing ??= (async () => { child.kill('SIGTERM'); await child })()
  const stop = (): void => { void close() }
  signal.addEventListener('abort', stop, { once: true })
  const timeout = setTimeout(() => { ready.reject(new Error('Harness startup timed out; run its Web profile to inspect the error')) }, timeoutMs)
  const read = (): ((data: Buffer) => void) => {
    let pending = ''
    return (data) => {
      pending += data.toString()
      const lines = pending.split('\n')
      pending = lines.splice(-1).join('').slice(-8192)
      for (const line of lines) {
        const match = /^dsh web: (https?:\/\/\S+)\s*$/u.exec(line.trim())
        if (match?.[1] !== undefined) ready.resolve(match[1])
        else if (line.trim() !== '') report(line.replace(/([?&]token=)[^\s&]+/gu, '$1[redacted]'))
      }
    }
  }
  child.stdout.on('data', read())
  child.stderr.on('data', read())
  void child.then((result) => {
    ready.reject(new Error(`Harness exited before startup (${result.exitCode ?? result.signal ?? 'unknown'}); check the backend profile`))
  })
  try {
    signal.throwIfAborted()
    const url = await ready.promise
    return { url, close: async () => {
      signal.removeEventListener('abort', stop)
      await close()
    } }
  } catch (error) {
    signal.removeEventListener('abort', stop)
    await close()
    throw error
  } finally { clearTimeout(timeout) }
}
