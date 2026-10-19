/** The terminal command line validates its flags before any backend starts. */
import { Context } from '@deepseek-ai/cordis'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { afterEach, expect, it, vi } from 'vitest'
import { apply, inject, name, type TuiStartup } from '../src/startup.ts'

const originalStdout = internals.stdout
const originalStderr = internals.stderr
const tty = { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY }
afterEach(() => {
  internals.stdout = originalStdout
  internals.stderr = originalStderr
  Object.defineProperty(process.stdin, 'isTTY', { value: tty.stdin, configurable: true })
  Object.defineProperty(process.stdout, 'isTTY', { value: tty.stdout, configurable: true })
})

function parse(args: string[], interactive = true) {
  Object.defineProperty(process.stdin, 'isTTY', { value: interactive, configurable: true })
  Object.defineProperty(process.stdout, 'isTTY', { value: interactive, configurable: true })
  let out = ''
  internals.stdout = { write: (chunk) => { out += chunk } }
  internals.stderr = { write: (chunk) => { out += chunk } }
  const ctx = new Context()
  const exit = vi.fn()
  provideCmdline(ctx, { args, exit })
  const provided = vi.spyOn(ctx, 'provide')
  apply(ctx)
  return { exit, out, started: provided.mock.calls.find(call => call[0] === 'tuiStartup')?.[1] as TuiStartup | undefined }
}

it('declares its identity and publishes the parsed invocation', () => {
  expect([name, inject]).toEqual(['tui-startup', ['cmdlineArgs']])
  const { started, exit } = parse(['--session', 's1', '--connect', 'http://127.0.0.1:1/?token=t', '--backend-profile', 'dev', '--port', '8080'])
  expect(started).toEqual({ session: 's1', connect: 'http://127.0.0.1:1/?token=t', backendProfile: 'dev', port: 8080 })
  expect(exit).not.toHaveBeenCalled()
  expect(parse([]).started).toEqual({ backendProfile: 'web', port: 0 })
})

it('rejects invalid ports, empty sessions, the terminal profile as backend, and redirected streams', () => {
  for (const [args, message] of [
    [['--port', '65536'], '--port must be an integer'],
    [['--port', 'abc'], '--port must be an integer'],
    [['--session', ' '], '--session must not be empty'],
    [['--backend-profile', 'tui'], 'backend profile must not be the terminal profile'],
  ] as const) {
    const result = parse([...args])
    expect(result.exit).toHaveBeenCalledWith(1)
    expect(result.started).toBeUndefined()
    expect(result.out).toContain(message)
  }
  const redirected = parse([], false)
  expect(redirected.exit).toHaveBeenCalledWith(1)
  expect(redirected.out).toContain('requires an interactive terminal')
})

it('prints usage for help', () => {
  const { out, exit } = parse(['--help'])
  expect(out).toContain('Usage: dsh tui')
  expect(exit).toHaveBeenCalledWith(0)
})
