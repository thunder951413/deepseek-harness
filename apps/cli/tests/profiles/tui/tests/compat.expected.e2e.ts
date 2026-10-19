/**
 * Release compatibility probe: an installed terminal plugin against an installed dsh.
 * Skipped unless `scripts/release/verify-tui-compat.ts` supplies a command and a prepared DSH_HOME,
 * so ordinary runs never depend on a released engine.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node-pty'
import type { Terminal as TerminalType } from '@xterm/headless'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { Terminal } = require('@xterm/headless') as typeof import('@xterm/headless')
const command = process.env.DSH_TUI_COMPAT_COMMAND
const home = process.env.DSH_TUI_COMPAT_HOME

it.skipIf(command === undefined || home === undefined || process.platform === 'win32')(
  'opens a conversation, reads optional features, lists history, and exits through an installed dsh', async () => {
    if (command === undefined || home === undefined) return
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-tui-compat-'))
    const terminal: TerminalType = new Terminal({ cols: 120, rows: 40, allowProposedApi: true })
    const child = spawn(command, ['--profile', 'tui'], { cwd, cols: 120, rows: 40, name: 'xterm-256color',
      env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', NO_COLOR: '1' } })
    const exited = Promise.withResolvers<number>()
    child.onExit(({ exitCode }) => { exited.resolve(exitCode) })
    const writes: Promise<void>[] = []
    child.onData((data) => { writes.push(new Promise<void>((resolve) => { terminal.write(data, resolve) })) })
    const screen = (): string => Array.from({ length: terminal.rows }, (_, index) =>
      terminal.buffer.active.getLine(terminal.buffer.active.viewportY + index)?.translateToString(true) ?? '').join('\n')
    try {
      await expect.poll(screen, { timeout: 60000 }).toContain('DeepSeek Harness · ')
      await expect.poll(screen, { timeout: 20000 }).toContain('Message · Enter send')
      await expect.poll(screen, { timeout: 20000 }).toContain('Model:')
      child.write('/stats\r')
      await expect.poll(screen, { timeout: 20000 }).toContain('Whole session')
      child.write('\r')
      child.write('/resume\r')
      await expect.poll(screen, { timeout: 20000 }).toContain('Conversations ·')
      child.write('\x1b')
      await expect.poll(screen, { timeout: 20000 }).not.toContain('Conversations ·')
      expect(screen()).not.toMatch(/incompatible|cannot provide|adapter/iu)
      child.write('\x11')
      expect(await exited.promise).toBe(0)
    } catch (error) {
      throw new Error(`${String(error)}\n${screen()}`)
    } finally {
      child.kill()
      await Promise.all(writes)
      terminal.dispose()
      await rm(cwd, { recursive: true, force: true })
    }
  })
