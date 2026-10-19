/** Install a built terminal release into a scratch DSH_HOME and probe it against one installed dsh. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { isEntry, runConcurrent } from './process.ts'

/**
 * Run the release installer and the compatibility probe for one dsh executable.
 * @param root - repository containing the probe.
 * @param release - directory produced by `create-tui-plugin.ts`.
 * @param command - executable path of the dsh under test; it must not contain spaces.
 * @returns after the probe passes; rejects when installation or the probe fails.
 */
export async function verifyTuiCompat(root: string, release: string, command: string): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), 'dsh-tui-compat-home-'))
  const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }
  try {
    await runConcurrent(process.execPath, [join(release, 'install.mjs'), '--dsh', command], { cwd: root, env })
    await runConcurrent('pnpm', ['exec', 'vitest', 'run', '--config', 'vitest.expected.config.ts',
      'apps/cli/tests/profiles/tui/tests/compat.expected.e2e.ts'], {
      cwd: root, env: { ...env, DSH_TUI_COMPAT_COMMAND: command, DSH_TUI_COMPAT_HOME: home },
    })
  } finally { rmSync(home, { recursive: true, force: true }) }
}

if (isEntry(import.meta.url)) {
  const { values } = parseArgs({ options: { release: { type: 'string' }, dsh: { type: 'string' } } })
  if (values.release === undefined || values.dsh === undefined) {
    throw new Error('Usage: verify-tui-compat.ts --release <create-tui-plugin output> --dsh <dsh executable>')
  }
  await verifyTuiCompat(process.cwd(), resolve(values.release), resolve(values.dsh))
}
