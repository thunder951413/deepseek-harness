/** Package the terminal and its frozen Web client without a Harness engine. */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { build } from 'tsdown'
import { isEntry, runConcurrent } from './process.ts'

/** Build one external bundle for an existing dsh installation.
 * @param root - built repository supplying the client artifacts.
 * @param output - new release directory.
 * @param version - independent terminal package version.
 * @returns after plugin.tgz, installer, and checksums are ready. */
export async function createTuiPlugin(root: string, output: string, version: string): Promise<void> {
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u.test(version)) throw new Error('Expected a package version')
  if (existsSync(output)) throw new Error(`Output already exists: ${output}`)
  const source = join(root, 'packages/bundle/tui-app')
  const owner = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')) as {
    version: string
    dependencies: Record<string, string>
  }
  const cordis = JSON.parse(readFileSync(join(root, 'vendor/cordis/package.json'), 'utf8')) as { version: string }
  const stage = join(output, 'package')
  mkdirSync(stage, { recursive: true })
  await build({ config: false, entry: {
    index: join(source, 'lib/types/index.js'), startup: join(source, 'lib/types/startup.js'),
  }, outDir: join(stage, 'lib'), format: 'esm', platform: 'node', target: 'es2024', dts: false,
  deps: { neverBundle: ['@deepseek-ai/cordis'], alwaysBundle: [/^@deepseek-ai\//u] }, fixedExtension: false, clean: true })
  const emittedFiles: string[] = readdirSync(join(stage, 'lib'), { encoding: 'utf8', recursive: true })
  for (const entry of emittedFiles.filter(name => name.endsWith('.js'))) {
    const code = readFileSync(join(stage, 'lib', entry), 'utf8')
    const imports = [...code.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)(["'])(@deepseek-ai\/[^"']+)\1/gu)].map(match => match[2])
    if (imports.some(name => name !== '@deepseek-ai/cordis')) throw new Error(`Terminal artifact retains a Harness import: ${imports.join(', ')}`)
  }
  const dependencies = Object.fromEntries(Object.entries(owner.dependencies).filter(([name]) => !name.startsWith('@deepseek-ai/')))
  writeFileSync(join(stage, 'package.json'), `${JSON.stringify({
    name: '@surfing/dsh-tui', version, type: 'module', license: 'MIT',
    description: 'Independent terminal client for the DeepSeek Harness Web API',
    engines: { node: '^22.19.0 || >=24.0.0' },
    exports: { '.': './lib/index.js', './startup': './lib/startup.js', './cordis.patch.yml': './cordis.patch.yml', './package.json': './package.json' },
    files: ['lib', 'cordis.patch.yml', 'README.md', 'README.zh.md', 'README.i18n.yaml', 'LICENSE', 'THIRD_PARTY_NOTICES.md'],
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    peerDependencies: { '@deepseek-ai/cordis': `~${cordis.version}` }, dependencies,
  }, null, 2)}\n`)
  writeFileSync(join(stage, 'cordis.patch.yml'), readFileSync(join(source, 'cordis.patch.yml'), 'utf8')
    .replaceAll('@deepseek-ai/dsh-tui-app', '@surfing/dsh-tui'))
  for (const name of ['README.md', 'README.zh.md', 'README.i18n.yaml']) copyFileSync(join(source, name), join(stage, name))
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) copyFileSync(join(root, name), join(stage, name))
  await runConcurrent('npm', ['pack', '--ignore-scripts', '--pack-destination', output], { cwd: stage })
  renameSync(join(output, `surfing-dsh-tui-${version}.tgz`), join(output, 'plugin.tgz'))
  copyFileSync(join(root, 'scripts/release/tui-plugin/install.mjs'), join(output, 'install.mjs'))
  copyFileSync(join(root, 'scripts/release/tui-plugin/INSTALL.txt'), join(output, 'INSTALL.txt'))
  const digest = createHash('sha256').update(readFileSync(join(output, 'plugin.tgz'))).digest('hex')
  writeFileSync(join(output, 'release.json'), `${JSON.stringify({ package: '@surfing/dsh-tui', version,
    sha256: digest, testedHarness: owner.version, protocol: 'Harness Web Remote', id: `dsh-tui-${version}-${digest.slice(0, 12)}` }, null, 2)}\n`)
  rmSync(stage, { recursive: true, force: true })
  console.log(`TUI plugin: ${output}; engine supplied by the existing dsh installation`)
}

if (isEntry(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: 'string' }, version: { type: 'string' } } })
  if (values.out === undefined || values.version === undefined) throw new Error('Usage: create-tui-plugin.ts --out <new-directory> --version <version>')
  await createTuiPlugin(process.cwd(), resolve(values.out), values.version)
}
