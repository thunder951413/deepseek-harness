/** scripts/setup-tui.sh against throwaway Git repositories: the paths that decide whether anything changes. */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'

const scripts = import.meta.dirname
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

const isolated = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...isolated } }).trim()
}

/**
 * An upstream repository and a clone holding the scripts, an isolated DSH_HOME, a `dsh` command this
 * script owns, and `npm`/`pnpm` stand-ins that fail, so a run that reaches the build stops there.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'setup-tui-'))
  roots.push(root)
  const upstream = join(root, 'upstream')
  const checkout = join(root, 'checkout')
  const home = join(root, 'home')
  const bin = join(root, 'bin')
  const tools = join(root, 'tools')
  mkdirSync(upstream)
  git(upstream, 'init', '-q', '-b', 'master')
  git(upstream, 'config', 'user.email', 'test@example.com')
  git(upstream, 'config', 'user.name', 'Test')
  writeFileSync(join(upstream, 'shared.txt'), 'base\n')
  git(upstream, 'add', '.')
  git(upstream, 'commit', '-q', '-m', 'base')
  git(root, 'clone', '-q', upstream, checkout)
  git(checkout, 'config', 'user.email', 'test@example.com')
  git(checkout, 'config', 'user.name', 'Test')
  mkdirSync(join(checkout, 'scripts'), { recursive: true })
  for (const file of ['setup-tui.sh', 'pinned-pnpm.sh', 'dsh-wrapper.sh']) copyFileSync(join(scripts, file), join(checkout, 'scripts', file))
  writeFileSync(join(checkout, 'package.json'), JSON.stringify({ packageManager: 'pnpm@0.0.0-test' }))
  git(checkout, 'add', '.')
  git(checkout, 'commit', '-q', '-m', 'add the setup script')
  mkdirSync(bin)
  writeFileSync(join(bin, 'dsh'), '#!/bin/sh\n# managed by scripts/setup-tui.sh\n')
  chmodSync(join(bin, 'dsh'), 0o755)
  mkdirSync(tools)
  for (const tool of ['npm', 'pnpm']) {
    writeFileSync(join(tools, tool), '#!/bin/sh\nexit 1\n')
    chmodSync(join(tools, tool), 0o755)
  }
  const env = { ...process.env, ...isolated, DSH_HOME: home, PATH: `${tools}:${process.env.PATH ?? ''}` }
  const script = join(checkout, 'scripts', 'setup-tui.sh')
  const run = (...args: string[]) => spawnSync('bash', [script, '--bin-dir', bin, ...args], { cwd: checkout, encoding: 'utf8', env })
  const start = (...args: string[]) => spawn('bash', [script, '--bin-dir', bin, ...args], { cwd: checkout, stdio: 'ignore', env })
  const state = (): Record<string, unknown> =>
    JSON.parse(readFileSync(join(home, 'addons', 'dsh-tui', 'auto-update.json'), 'utf8')) as Record<string, unknown>
  const installed = (): void => {
    mkdirSync(join(home, 'addons', 'dsh-tui'), { recursive: true })
    writeFileSync(join(home, 'addons', 'dsh-tui', 'current.json'),
      JSON.stringify({ id: `dsh-tui-0.0.0-local.${git(checkout, 'rev-parse', '--short', 'HEAD')}-abc` }))
  }
  return { upstream, checkout, home, bin, run, start, state, installed }
}

function commitUpstream(upstream: string, file: string, text: string): void {
  writeFileSync(join(upstream, file), text)
  git(upstream, 'add', '.')
  git(upstream, 'commit', '-q', '-m', `change ${file}`)
}

it('merges the official branch before building, and stops at the build stand-in', () => {
  const { upstream, checkout, run, state } = fixture()
  commitUpstream(upstream, 'new.txt', 'upstream\n')
  expect(run().status).toBe(1)
  expect(git(checkout, 'log', '-1', '--format=%s')).toMatch(/^Merge /u)
  expect(state()).toMatchObject({ status: 'failed', remote: 'origin', branch: 'master', name: 'dsh', intervalDays: 7 })
  expect(state().message).toContain('pinned pnpm')
})

it('builds uncommitted work by hand without merging, but an unattended run stops', () => {
  const { upstream, checkout, run, state } = fixture()
  commitUpstream(upstream, 'new.txt', 'upstream\n')
  writeFileSync(join(checkout, 'shared.txt'), 'local edit\n')
  const before = git(checkout, 'rev-parse', 'HEAD')
  const manual = run()
  expect(manual.stdout).toContain('skipping the merge')
  expect(git(checkout, 'rev-parse', 'HEAD')).toBe(before)
  expect(state().message).toContain('pinned pnpm')
  expect(run('--wait-for-idle', '--idle-poll-seconds', '1').status).toBe(1)
  expect(git(checkout, 'rev-parse', 'HEAD')).toBe(before)
  expect(state().message).toContain('uncommitted changes')
})

it('aborts a conflicting merge and leaves the branch where it was', () => {
  const { upstream, checkout, run, state } = fixture()
  commitUpstream(upstream, 'shared.txt', 'upstream\n')
  writeFileSync(join(checkout, 'shared.txt'), 'local\n')
  git(checkout, 'commit', '-q', '-am', 'local change')
  const before = git(checkout, 'rev-parse', 'HEAD')
  expect(run('--interval-days', '3').status).toBe(1)
  expect(git(checkout, 'rev-parse', 'HEAD')).toBe(before)
  expect(git(checkout, 'status', '--porcelain', '--untracked-files=no')).toBe('')
  expect(state()).toMatchObject({ status: 'failed', intervalDays: 3 })
  expect(state().message).toContain('conflicts')
})

it('records an up-to-date install, then skips until the interval passes', () => {
  const { checkout, run, state, installed } = fixture()
  installed()
  expect(run().status).toBe(0)
  const first = state()
  expect(first).toMatchObject({ status: 'current', checkout, name: 'dsh' })
  expect(run('--if-due').status).toBe(0)
  expect(state().updatedAt).toBe(first.updatedAt)
})

it('refuses to replace a command it did not write, rejects bad options, and disables on request', () => {
  const { bin, home, run, state } = fixture()
  writeFileSync(join(bin, 'dsh'), '#!/bin/sh\necho official\n')
  expect(run().status).toBe(1)
  expect(state().message).toContain('--force')
  expect(run('--interval-days', '0').status).toBe(2)
  expect(run('--name', 'bad/name').status).toBe(2)
  expect(run('--disable').status).toBe(0)
  expect(() => readFileSync(join(home, 'addons', 'dsh-tui', 'auto-update.json'))).toThrow()
})

it('waits for every dsh of the checkout to exit, and refuses a manual run while one is open', async ({ onTestFinished }) => {
  const { checkout, run, start, state, installed } = fixture()
  installed()
  // A process whose command line names the checkout's CLI stands in for a running dsh.
  const cli = join(checkout, 'apps', 'cli', 'lib', 'bin.js')
  const dsh = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', cli], { stdio: 'ignore' })
  onTestFinished(() => { dsh.kill() })
  await expect.poll(() => spawnSync('pgrep', ['-f', cli]).status).toBe(0)
  expect(run().status).toBe(1)
  expect(state().message).toContain('a dsh from this checkout is running')
  const waiting = start('--wait-for-idle', '--idle-poll-seconds', '1')
  const finished = new Promise<number | null>((resolve) => { waiting.on('exit', resolve) })
  await expect.poll(() => state().status, { timeout: 10_000 }).toBe('waiting')
  dsh.kill()
  expect(await finished).toBe(0)
  expect(state().status).toBe('current')
}, 30_000)
