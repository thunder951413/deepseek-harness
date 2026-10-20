/** The weekly sync record: validation, the due rule, and the detached launch. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { readUpdateRecord, startUpdate, updateDue, type UpdateRecord } from '../src/auto-update.ts'

const record: UpdateRecord = { checkout: '/src/dsh', remote: 'origin', branch: 'master', name: 'dsh', binDir: '/home/bin', intervalDays: 7,
  lastCheck: 1_000, status: 'updated', message: 'Merged 3 official commit(s)', log: '/home/auto-update.log' }

it('reads a record, treats a missing one as disabled, and rejects a malformed one', async ({ onTestFinished }) => {
  const directory = await mkdtemp(join(tmpdir(), 'tui-update-'))
  onTestFinished(async () => { await rm(directory, { recursive: true, force: true }) })
  const path = join(directory, 'auto-update.json')
  expect(await readUpdateRecord(path)).toBeUndefined()
  await writeFile(path, JSON.stringify({ ...record, version: 1, updatedAt: 2 }))
  expect(await readUpdateRecord(path)).toEqual(record)
  const { name: _name, binDir: _binDir, ...legacy } = record
  await writeFile(path, JSON.stringify({ ...legacy, version: 1, dsh: '/home/bin/dsh' }))
  expect(await readUpdateRecord(path)).toEqual(record)
  for (const broken of [{ ...record, status: 'unknown' }, { ...record, intervalDays: 0 }, { ...record, lastCheck: '1' }, { ...record, name: 3 }, null]) {
    await writeFile(path, JSON.stringify(broken))
    await expect(readUpdateRecord(path)).rejects.toThrow('Invalid automatic update record')
  }
  await expect(readUpdateRecord(directory)).rejects.toMatchObject({ code: 'EISDIR' })
})

it('is due once the interval has passed since the last run started', () => {
  expect(updateDue(record, 1_000 + 7 * 86_400_000 - 1)).toBe(false)
  expect(updateDue(record, 1_000 + 7 * 86_400_000)).toBe(true)
})

it('repeats the recorded options in a detached run that outlives the terminal', () => {
  const unref = vi.fn()
  const launch = vi.fn((_command: string, _args: string[], _options: object) => ({ unref }))
  startUpdate(record, launch)
  expect(launch).toHaveBeenCalledWith('bash', ['/src/dsh/scripts/setup-tui.sh', '--if-due', '--wait-for-idle', '--remote', 'origin',
    '--branch', 'master', '--name', 'dsh', '--bin-dir', '/home/bin', '--interval-days', '7'], { cwd: '/src/dsh', detached: true, stdio: 'ignore' })
  expect(unref).toHaveBeenCalled()
})
