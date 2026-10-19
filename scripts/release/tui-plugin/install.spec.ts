/** External terminal installation preserves the engine and profile data. */
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'

function fixture(bundles?: string[]) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-tui-plugin-install-'))
  onTestFinished(() => { rmSync(directory, { recursive: true, force: true }) })
  const release = join(directory, 'release')
  const home = join(directory, 'home')
  mkdirSync(release)
  mkdirSync(home)
  const cli = join(directory, 'official-dsh')
  const body = `#!/usr/bin/env node
const fs = require('node:fs'); const path = require('node:path');
const args = process.argv.slice(2); const home = process.env.DSH_HOME;
fs.appendFileSync(path.join(home, 'commands.jsonl'), JSON.stringify(args) + '\\n');
if (args[0] === 'plugin') {
  const dir = path.join(home, 'profiles', args[2]); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'package.json');
  const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {private:true,dsh:{profile:{bundles:['@deepseek-ai/dsh-base']}}};
  old.dependencies = {...old.dependencies, '@surfing/dsh-tui':'file:' + args[4]};
  fs.writeFileSync(file, JSON.stringify(old));
}
if (args.includes('--help') && process.env.TUI_HELP_FAIL === '1') process.exit(7);
console.log(args.includes('--help') ? 'terminal help' : '0.2.1-rc.2');
`
  writeFileSync(cli, body, { mode: 0o755 })
  chmodSync(cli, 0o755)
  const installer = fileURLToPath(new URL('./install.mjs', import.meta.url))
  copyFileSync(installer, join(release, 'install.mjs'))
  writeFileSync(join(release, 'INSTALL.txt'), 'instructions\n')
  writeFileSync(join(release, 'plugin.tgz'), 'fixture-tarball')
  const metadata = { id: 'dsh-tui-0.1.0-abcdef', package: '@surfing/dsh-tui', version: '0.1.0', testedHarness: '0.2.1-rc.2',
    sha256: createHash('sha256').update('fixture-tarball').digest('hex') }
  writeFileSync(join(release, 'release.json'), JSON.stringify(metadata))
  const profile = join(home, 'profiles', 'tui')
  const manifest = join(profile, 'package.json')
  if (bundles !== undefined) {
    mkdirSync(profile, { recursive: true })
    writeFileSync(manifest, JSON.stringify({ private: true, custom: 'keep', dsh: { profile: { bundles } } }))
    writeFileSync(join(profile, 'cordis.patch.yml'), '# user overrides\n[]\n')
  }
  const invoke = (args: string[] = [], script = join(release, 'install.mjs'), extraEnv: Record<string, string> = {}) => spawnSync(process.execPath,
    [script, '--dsh', cli, ...args], { encoding: 'utf8', env: { ...process.env, DSH_HOME: home, ...extraEnv } })
  return { directory, release, home, cli, body, metadata, manifest, profile, invoke }
}

describe.skipIf(process.platform === 'win32')('external terminal installer (POSIX executable fixture)', () => {
  it('installs only the plugin, keeps the engine, and reattaches from its saved copy', () => {
    const f = fixture()
    const result = f.invoke()
    expect(result.status, result.stderr).toBe(0)
    const manifest = JSON.parse(readFileSync(f.manifest, 'utf8')) as { dependencies: Record<string, string>; dsh: { profile: { bundles: string[] } } }
    expect(Object.keys(manifest.dependencies)).toEqual(['@surfing/dsh-tui'])
    expect(manifest.dsh.profile.bundles).toEqual(['@surfing/dsh-tui'])
    expect(readFileSync(f.cli, 'utf8')).toBe(f.body)
    const saved = join(f.home, 'addons', 'dsh-tui')
    rmSync(f.release, { recursive: true })
    const again = f.invoke([], join(saved, 'install.mjs'))
    expect(again.status, again.stderr).toBe(0)
    expect(readFileSync(f.cli, 'utf8')).toBe(f.body)
    expect(again.stdout).toContain('After updating official dsh')
  })

  it('backs up an older terminal profile and preserves its user patch and metadata', () => {
    const f = fixture(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-tui-app'])
    const before = readFileSync(f.manifest, 'utf8')
    expect(f.invoke().status).toBe(0)
    expect(readFileSync(`${f.manifest}.before-independent-tui`, 'utf8')).toBe(before)
    expect(readFileSync(join(f.profile, 'cordis.patch.yml'), 'utf8')).toBe('# user overrides\n[]\n')
    expect(JSON.parse(readFileSync(f.manifest, 'utf8'))).toHaveProperty('custom', 'keep')
  })

  it('rejects an unrelated profile without changing its manifest', () => {
    const f = fixture(['@example/other-bundle'])
    const before = readFileSync(f.manifest, 'utf8')
    const result = f.invoke()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('other bundles')
    expect(readFileSync(f.manifest, 'utf8')).toBe(before)
  })

  it('rejects altered payloads before invoking dsh or touching the profile', () => {
    const f = fixture()
    writeFileSync(join(f.release, 'plugin.tgz'), 'altered')
    const result = f.invoke()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('checksum mismatch')
    expect(existsSync(join(f.home, 'commands.jsonl'))).toBe(false)
    expect(existsSync(f.manifest)).toBe(false)
  })

  it('restores the previous selection when the installed plugin cannot start', () => {
    const f = fixture(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-tui-app'])
    const result = f.invoke([], join(f.release, 'install.mjs'), { TUI_HELP_FAIL: '1' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('previous bundle selection restored')
    expect(JSON.parse(readFileSync(f.manifest, 'utf8'))).toHaveProperty('dsh.profile.bundles',
      ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-tui-app'])
  })

  it('refuses to repurpose the Web or Desktop profile', () => {
    const f = fixture()
    expect(f.invoke(['--profile', 'web']).status).toBe(1)
    expect(f.invoke(['--profile', 'desktop']).status).toBe(1)
    expect(existsSync(join(f.home, 'commands.jsonl'))).toBe(false)
  })

  it('warns about a different dsh version and installs, but refuses with --require-match', () => {
    const f = fixture()
    f.metadata.testedHarness = '9.9.9'
    writeFileSync(join(f.release, 'release.json'), JSON.stringify(f.metadata))
    const warned = f.invoke()
    expect(warned.status, warned.stderr).toBe(0)
    expect(warned.stderr).toContain('built and tested for dsh 9.9.9')
    expect(warned.stderr).toContain('"0.2.1-rc.2"')
    const strict = fixture()
    strict.metadata.testedHarness = '9.9.9'
    writeFileSync(join(strict.release, 'release.json'), JSON.stringify(strict.metadata))
    const refused = strict.invoke(['--require-match'])
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain('Install the terminal release built for that version')
    expect(existsSync(strict.manifest)).toBe(false)
  })

  it('stays quiet when the dsh version matches the tested version', () => {
    const f = fixture()
    const result = f.invoke(['--require-match'])
    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).not.toContain('Warning')
  })
})
