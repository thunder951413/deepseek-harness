/** The dsh command written by scripts/setup-tui.sh: waiting for a sync, and never waiting for the sync that runs it. */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'

const helper = join(import.meta.dirname, 'dsh-wrapper.sh')
const cleanup: (() => void)[] = []
afterEach(() => { for (const step of cleanup.splice(0)) step() })

/** A checkout whose CLI prints its arguments, the generated command, and a lock held by a live process. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-wrapper-'))
  cleanup.push(() => { rmSync(root, { recursive: true, force: true }) })
  mkdirSync(join(root, 'apps', 'cli', 'lib'), { recursive: true })
  writeFileSync(join(root, 'apps', 'cli', 'lib', 'bin.js'), "process.stdout.write('ran ' + process.argv.slice(2).join(' '))\n")
  const command = join(root, 'dsh')
  execFileSync('bash', ['-c', `. '${helper}' && write_dsh_wrapper '${command}' dsh '${root}'`])
  const home = join(root, 'home')
  const lock = join(home, 'addons', 'dsh-tui', 'auto-update.lock')
  const holder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  cleanup.push(() => { holder.kill() })
  const hold = (): void => {
    mkdirSync(lock, { recursive: true })
    writeFileSync(join(lock, 'pid'), String(holder.pid))
  }
  return { command, home, holder, hold }
}

it('runs the checkout CLI at once when no sync holds the lock', () => {
  const { command, home } = fixture()
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', env: { ...process.env, DSH_HOME: home } })
  expect(result.status).toBe(0)
  expect(result.stdout).toBe('ran --version')
})

it('does not wait for the sync that runs it, which would otherwise deadlock', () => {
  const { command, home, holder, hold } = fixture()
  hold()
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 5_000,
    env: { ...process.env, DSH_HOME: home, DSH_TUI_SYNC_PID: String(holder.pid) } })
  expect(result.status).toBe(0)
  expect(result.stdout).toBe('ran --version')
  expect(result.stderr).toBe('')
})

it('waits while another process holds the lock and runs once it exits', async () => {
  const { command, home, holder, hold } = fixture()
  hold()
  const child = spawn(command, ['tui'], { env: { ...process.env, DSH_HOME: home } })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (data: Buffer) => { stdout += data.toString() })
  child.stderr.on('data', (data: Buffer) => { stderr += data.toString() })
  const exited = new Promise<number | null>((resolve) => { child.on('exit', resolve) })
  await expect.poll(() => stderr, { timeout: 5_000 }).toContain('waiting for it')
  expect(stdout).toBe('')
  holder.kill()
  expect(await exited).toBe(0)
  expect(stdout).toBe('ran tui')
}, 15_000)
