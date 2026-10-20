/** scripts/sync-upstream-tui.sh against throwaway Git repositories: the paths that decide whether anything changes. */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'

const scripts = import.meta.dirname
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } }).trim()
}

/** An upstream repository and a clone holding the script, plus a fake dsh and an isolated DSH_HOME. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sync-upstream-'))
  roots.push(root)
  const upstream = join(root, 'upstream')
  const checkout = join(root, 'checkout')
  const home = join(root, 'home')
  const bin = join(root, 'bin')
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
  copyFileSync(join(scripts, 'sync-upstream-tui.sh'), join(checkout, 'scripts', 'sync-upstream-tui.sh'))
  copyFileSync(join(scripts, 'pinned-pnpm.sh'), join(checkout, 'scripts', 'pinned-pnpm.sh'))
  git(checkout, 'add', '.')
  git(checkout, 'commit', '-q', '-m', 'add the sync script')
  mkdirSync(bin)
  writeFileSync(join(bin, 'dsh'), '#!/bin/sh\necho 0.0.0\n')
  chmodSync(join(bin, 'dsh'), 0o755)
  const run = (...args: string[]) => spawnSync('bash', [join(checkout, 'scripts', 'sync-upstream-tui.sh'), ...args], {
    cwd: checkout, encoding: 'utf8',
    env: { ...process.env, DSH_HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}`, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  })
  const state = (): Record<string, unknown> => JSON.parse(readFileSync(join(home, 'addons', 'dsh-tui', 'auto-update.json'), 'utf8')) as Record<string, unknown>
  const start = (...args: string[]) => spawn('bash', [join(checkout, 'scripts', 'sync-upstream-tui.sh'), ...args], {
    cwd: checkout, stdio: 'ignore',
    env: { ...process.env, DSH_HOME: home, PATH: `${bin}:${process.env.PATH ?? ''}`, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  })
  return { upstream, checkout, home, run, start, state }
}

it('stops without merging when tracked files have uncommitted changes', () => {
  const { upstream, checkout, run, state } = fixture()
  writeFileSync(join(upstream, 'new.txt'), 'upstream\n')
  git(upstream, 'add', '.')
  git(upstream, 'commit', '-q', '-m', 'upstream work')
  writeFileSync(join(checkout, 'shared.txt'), 'local edit\n')
  const before = git(checkout, 'rev-parse', 'HEAD')
  expect(run().status).toBe(1)
  expect(git(checkout, 'rev-parse', 'HEAD')).toBe(before)
  expect(state()).toMatchObject({ status: 'failed', intervalDays: 7 })
  expect(state().message).toContain('uncommitted changes')
})

it('aborts a conflicting merge and leaves the branch where it was', () => {
  const { upstream, checkout, run, state } = fixture()
  writeFileSync(join(upstream, 'shared.txt'), 'upstream\n')
  git(upstream, 'commit', '-q', '-am', 'upstream change')
  writeFileSync(join(checkout, 'shared.txt'), 'local\n')
  git(checkout, 'commit', '-q', '-am', 'local change')
  const before = git(checkout, 'rev-parse', 'HEAD')
  expect(run('--interval-days', '3').status).toBe(1)
  expect(git(checkout, 'rev-parse', 'HEAD')).toBe(before)
  expect(git(checkout, 'status', '--porcelain', '--untracked-files=no')).toBe('')
  expect(state()).toMatchObject({ status: 'failed', intervalDays: 3 })
  expect(state().message).toContain('conflicts')
})

it('records an up-to-date checkout whose terminal is already installed, then skips until the interval passes', () => {
  const { checkout, home, run, state } = fixture()
  const commit = git(checkout, 'rev-parse', '--short', 'HEAD')
  mkdirSync(join(home, 'addons', 'dsh-tui'), { recursive: true })
  writeFileSync(join(home, 'addons', 'dsh-tui', 'current.json'), JSON.stringify({ id: `dsh-tui-0.0.0-local.${commit}-abc` }))
  expect(run().status).toBe(0)
  const first = state()
  expect(first).toMatchObject({ status: 'current', checkout, remote: 'origin', branch: 'master' })
  expect(first.dsh).toMatch(/\/dsh$/u)
  expect(run('--if-due').status).toBe(0)
  expect(state().updatedAt).toBe(first.updatedAt)
})

it('rejects an invalid interval and deletes the record on --disable', () => {
  const { home, run } = fixture()
  expect(run('--interval-days', '0').status).toBe(2)
  expect(run('--dsh', 'missing-dsh-command').status).toBe(1)
  expect(run('--disable').status).toBe(0)
  expect(() => readFileSync(join(home, 'addons', 'dsh-tui', 'auto-update.json'))).toThrow()
})

it('waits for every dsh of the checkout to exit before syncing, and refuses a manual run while one is open', async ({ onTestFinished }) => {
  const { checkout, home, run, start, state } = fixture()
  const commit = git(checkout, 'rev-parse', '--short', 'HEAD')
  mkdirSync(join(home, 'addons', 'dsh-tui'), { recursive: true })
  writeFileSync(join(home, 'addons', 'dsh-tui', 'current.json'), JSON.stringify({ id: `dsh-tui-0.0.0-local.${commit}-abc` }))
  // A process whose command line names the checkout's CLI stands in for a running dsh.
  const dsh = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', join(checkout, 'apps', 'cli', 'lib', 'bin.js')], { stdio: 'ignore' })
  onTestFinished(() => { dsh.kill() })
  await expect.poll(() => spawnSync('pgrep', ['-f', join(checkout, 'apps', 'cli', 'lib', 'bin.js')]).status).toBe(0)
  expect(run().status).toBe(1)
  expect(state().message).toContain('a dsh from this checkout is running')
  const waiting = start('--wait-for-idle', '--idle-poll-seconds', '1')
  const finished = new Promise<number | null>((resolve) => { waiting.on('exit', resolve) })
  await expect.poll(() => state().status, { timeout: 10_000 }).toBe('waiting')
  dsh.kill()
  expect(await finished).toBe(0)
  expect(state().status).toBe('current')
}, 30_000)
