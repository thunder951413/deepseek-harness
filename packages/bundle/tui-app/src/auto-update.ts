/** Weekly background update of a source checkout, enabled by running scripts/setup-tui.sh from that checkout. */
import { spawn, type SpawnOptions } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/** The record scripts/setup-tui.sh writes after each run. */
export interface UpdateRecord {
  /** Checkout that holds the sync script. */
  readonly checkout: string
  readonly remote: string
  readonly branch: string
  /** Name of the dsh command the script writes. */
  readonly name: string
  /** Directory holding that command. */
  readonly binDir: string
  readonly intervalDays: number
  /** Start of the last run, in milliseconds since the epoch. */
  readonly lastCheck: number
  readonly status: 'waiting' | 'running' | 'updated' | 'current' | 'failed'
  readonly message: string
  /** File the script appends its output to. */
  readonly log: string
}

const STATUSES = new Set(['waiting', 'running', 'updated', 'current', 'failed'])

/**
 * Read the sync record.
 * @param path - `auto-update.json` under the terminal's addon directory.
 * @returns the record, or undefined when automatic sync was never enabled or has been disabled; throws for a malformed record.
 */
export async function readUpdateRecord(path: string): Promise<UpdateRecord | undefined> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    // No record means the user never enabled automatic sync.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const value: unknown = JSON.parse(text)
  const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
  // Records written before the setup and update scripts merged name the command by its path.
  const legacy = typeof record.dsh === 'string' && record.name === undefined && record.binDir === undefined
  const command = legacy ? { name: basename(String(record.dsh)), binDir: dirname(String(record.dsh)) }
    : { name: record.name, binDir: record.binDir }
  const strings = [record.checkout, record.remote, record.branch, command.name, command.binDir, record.status, record.message, record.log]
  if (strings.some(value => typeof value !== 'string') || !STATUSES.has(String(record.status))
    || typeof record.intervalDays !== 'number' || !(record.intervalDays > 0) || typeof record.lastCheck !== 'number') {
    throw new Error(`Invalid automatic update record ${path}; run scripts/setup-tui.sh again`)
  }
  return {
    checkout: String(record.checkout), remote: String(record.remote), branch: String(record.branch), name: String(command.name),
    binDir: String(command.binDir), intervalDays: record.intervalDays, lastCheck: record.lastCheck,
    status: record.status as UpdateRecord['status'], message: String(record.message), log: String(record.log),
  }
}

/**
 * Decide whether the next sync should start.
 * @param record - last recorded run.
 * @param now - current milliseconds since the epoch.
 * @returns true once `intervalDays` have passed since the last run started.
 */
export function updateDue(record: UpdateRecord, now: number): boolean {
  return now - record.lastCheck >= record.intervalDays * 86_400_000
}

/**
 * Start the sync script detached, so it outlives this terminal and waits for every dsh of the checkout to exit
 * before rebuilding; the script appends its own output to the record's log.
 * @param record - last recorded run, whose options the new run repeats.
 * @param launch - process launcher; tests substitute it.
 * @returns after the child process has been started.
 */
export function startUpdate(record: UpdateRecord,
  launch: (command: string, args: string[], options: SpawnOptions) => { unref(): void } = spawn): void {
  const child = launch('bash', [join(record.checkout, 'scripts', 'setup-tui.sh'), '--if-due', '--wait-for-idle',
    '--remote', record.remote, '--branch', record.branch, '--name', record.name, '--bin-dir', record.binDir,
    '--interval-days', String(record.intervalDays)], {
    cwd: record.checkout, detached: true, stdio: 'ignore',
  })
  child.unref()
}
