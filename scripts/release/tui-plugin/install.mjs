#!/usr/bin/env node
/** Install the terminal into an existing dsh profile without replacing its engine. */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? result.signal}`)
}

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? result.signal}`)
  return result.stdout.trim()
}

function install() {
  const { values } = parseArgs({ options: {
    dsh: { type: 'string', default: 'dsh' }, profile: { type: 'string', default: 'tui' }, help: { type: 'boolean' },
    'require-match': { type: 'boolean' },
  } })
  if (values.help) { console.log('Usage: node install.mjs [--dsh <existing-command>] [--profile <name>] [--require-match]'); return }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(values.profile) || ['web', 'desktop', 'headless', 'sdk', 'sdk-minimal', 'acp', 'plugin'].includes(values.profile)) {
    throw new Error('Choose a separate terminal profile such as tui')
  }
  const bundle = dirname(fileURLToPath(import.meta.url))
  const metadata = JSON.parse(readFileSync(join(bundle, 'release.json'), 'utf8'))
  const payload = join(bundle, 'plugin.tgz')
  if (!/^dsh-tui-[A-Za-z0-9.-]+$/u.test(metadata.id) || metadata.package !== '@surfing/dsh-tui') throw new Error('Invalid terminal release metadata')
  if (createHash('sha256').update(readFileSync(payload)).digest('hex') !== metadata.sha256) throw new Error('Terminal package checksum mismatch')
  const harness = capture(values.dsh, ['--version'])
  if (typeof metadata.testedHarness === 'string' && !harness.split(/\s+/u).includes(metadata.testedHarness)) {
    const note = `This terminal was built and tested for dsh ${metadata.testedHarness}; the selected dsh reports "${harness}".`
    if (values['require-match']) throw new Error(`${note} Install the terminal release built for that version.`)
    console.warn(`Warning: ${note}\nIf startup reports an incompatible interface, install the terminal release built for your dsh version.`)
  }
  const configuredHome = process.env.DSH_HOME?.trim()
  const home = resolve(configuredHome?.startsWith('~/') ? join(homedir(), configuredHome.slice(2)) : configuredHome || join(homedir(), '.dsh'))
  const profile = join(home, 'profiles', values.profile)
  const manifestPath = join(profile, 'package.json')
  const previous = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : undefined
  if (previous !== undefined) {
    const manifest = JSON.parse(previous)
    const selected = manifest.dsh?.profile?.bundles ?? []
    const known = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-tui-app', metadata.package]
    if (selected.some(name => !known.includes(name))) throw new Error('This profile contains other bundles; choose a fresh --profile name')
  }
  const saved = join(home, 'addons', 'dsh-tui', metadata.id)
  mkdirSync(saved, { recursive: true })
  for (const name of ['plugin.tgz', 'install.mjs', 'release.json', 'INSTALL.txt']) {
    const from = join(bundle, name)
    const to = join(saved, name)
    if (resolve(from) !== resolve(to)) copyFileSync(from, to)
  }
  run(values.dsh, ['plugin', '--profile', values.profile, 'add', join(saved, 'plugin.tgz')])
  const installed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (installed.dependencies?.[metadata.package] === undefined) throw new Error('dsh did not register the terminal package')
  const next = { ...installed, dsh: { ...installed.dsh, profile: { ...installed.dsh?.profile, bundles: [metadata.package] } } }
  if (previous !== undefined && !existsSync(`${manifestPath}.before-independent-tui`)) {
    writeFileSync(`${manifestPath}.before-independent-tui`, previous, { flag: 'wx' })
  }
  const stage = `${manifestPath}.tui-install-${process.pid}`
  const installedText = readFileSync(manifestPath, 'utf8')
  try {
    writeFileSync(stage, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' })
    if (readFileSync(manifestPath, 'utf8') !== installedText) throw new Error('Profile changed during terminal installation; retry after other package operations finish')
    renameSync(stage, manifestPath)
    try { run(values.dsh, ['--profile', values.profile, '--help']) } catch (error) {
      const bundles = previous === undefined ? ['@deepseek-ai/dsh-base'] : JSON.parse(previous).dsh?.profile?.bundles ?? []
      writeFileSync(manifestPath, `${JSON.stringify({ ...installed, dsh: { ...installed.dsh,
        profile: { ...installed.dsh?.profile, bundles } } }, null, 2)}\n`)
      throw new Error('Terminal startup check failed; previous bundle selection restored and the new package is left installed', { cause: error })
    }
  } finally { if (existsSync(stage)) unlinkSync(stage) }
  const addon = dirname(saved)
  writeFileSync(join(addon, 'current.json'), `${JSON.stringify({ id: metadata.id, profile: values.profile, dsh: values.dsh }, null, 2)}\n`)
  const helper = join(addon, 'install.mjs')
  writeFileSync(helper, `#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const base = dirname(fileURLToPath(import.meta.url));
const current = JSON.parse(readFileSync(join(base, 'current.json'), 'utf8'));
if (!/^dsh-tui-[A-Za-z0-9.-]+$/.test(current.id)) throw new Error('Invalid saved TUI release');
for (const key of ['dsh', 'profile']) {
  if (!process.argv.slice(2).some(arg => arg === '--' + key || arg.startsWith('--' + key + '='))) {
    process.argv.push('--' + key, current[key]);
  }
}
await import(pathToFileURL(join(base, current.id, 'install.mjs')).href);
`)
  console.log(`\nInstalled independent TUI ${metadata.version}.\nRun: ${values.dsh} --profile ${values.profile}\nAfter updating official dsh, run the same command; this profile and plugin stay in DSH_HOME.\nReattach to another installation: node ${helper} --dsh <command> --profile ${values.profile}\nThe Harness engine and user data were not replaced.`)
}
try { install() } catch (error) { console.error(`TUI installation failed: ${error.message}`); process.exitCode = 1 }
