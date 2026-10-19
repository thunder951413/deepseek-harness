/** Real terminal and Web-host lifecycle through the shipped profile. */
import { mkdtemp, mkdir, rm, writeFile, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire, stripTypeScriptTypes } from 'node:module'
import { spawn } from 'node-pty'
import type { Terminal as TerminalType } from '@xterm/headless'
import { expect, it } from 'vitest'
import { execa } from 'execa'
import { resolveExampleLaunch, resolveExampleMode } from '@deepseek-ai/dsh-loader-smoke'

const require = createRequire(import.meta.url)
const { Terminal } = require('@xterm/headless') as typeof import('@xterm/headless')
const root = fileURLToPath(new URL('../../../../../../', import.meta.url))
const installedBin = process.env.DSH_TUI_TEST_BIN
const externalCommand = process.env.DSH_TUI_TEST_COMMAND
const executable = externalCommand ?? process.execPath
const mode = installedBin === undefined && externalCommand === undefined ? resolveExampleMode() : 'lib'
const invocation = resolveExampleLaunch({ srcBin: join(root, 'apps/cli/src/bin.ts'), libBin: installedBin,
  mode, sourceImport: 'tsx/esm', tsconfigPath: join(root, 'tsconfig.base.json') })
const entry = externalCommand === undefined ? invocation.args : []

async function prepareTerminalProfile(home: string): Promise<void> {
  const directory = join(home, 'profiles', 'tui')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, dsh: { profile: { bundles: [] } } }))
  const plugin = process.env.DSH_TUI_PLUGIN_DIR ?? join(root, 'packages/bundle/tui-app')
  const main = pathToFileURL(join(plugin, mode === 'src' ? 'src/index.ts' : 'lib/index.js')).href
  const startup = pathToFileURL(join(plugin, mode === 'src' ? 'src/startup.ts' : 'lib/startup.js')).href
  const probe = join(directory, 'terminal-probe.mjs')
  if (externalCommand !== undefined) await writeFile(probe, `export function apply() {
  process.stdout.write('SHELL_HISTORY_SENTINEL\\n');
  const original = globalThis.console;
  process.once('exit', () => { process.stdout.write('Console restored: ' + String(globalThis.console === original) + '\\n'); });
}`)
  const probeEntry = externalCommand === undefined ? '' : `    - id: terminal-probe\n      name: ${pathToFileURL(probe).href}\n`
  await writeFile(join(directory, 'cordis.patch.yml'), `- insert:
${probeEntry}    - id: tui-startup
      name: ${startup}
    - id: tui
      name: ${main}
      inject: [tuiStartup]
      config:
        session: !!js ctx.tuiStartup.session
        connect: !!js ctx.tuiStartup.connect
        backendProfile: !!js ctx.tuiStartup.backendProfile
        port: !!js ctx.tuiStartup.port
`)
}

it.skipIf(process.platform === 'win32')('shares Web history, executes an approved Bash tool, answers questions, cancels, and resumes', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-tui-'))
  await prepareTerminalProfile(home)
  const backend = join(home, 'profiles', 'terminal-backend')
  await mkdir(backend, { recursive: true })
  await writeFile(join(backend, 'package.json'), JSON.stringify({ private: true, dsh: { profile: {
    bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
  } } }))
  const patch = join(backend, 'cordis.patch.yml')
  const cleanupProbe = join(home, 'cleanup-probe.mjs')
  await writeFile(join(home, 'sample file.md'), '# Sample\n')
  await writeFile(cleanupProbe, `process.stdout.write('SHELL_HISTORY_SENTINEL\\n')
const original = globalThis.console
process.once('exit', () => { process.stdout.write('Console restored: ' + String(globalThis.console === original) + '\\n') })
`)
  let fixture = join(root, 'apps/cli/tests/profiles/tui/tests/fixtures/model.ts')
  if (mode === 'lib') {
    const installedRequire = createRequire(installedBin ?? join(root, 'packages/bundle/base/package.json'))
    const modelModule = process.env.DSH_TUI_MODEL_MODULE ?? installedRequire.resolve('@deepseek-ai/dsh-llm')
    const source = stripTypeScriptTypes(await readFile(fixture, 'utf8'))
      .replace("'@deepseek-ai/dsh-llm'", JSON.stringify(pathToFileURL(modelModule).href))
    fixture = join(home, 'model.mjs')
    await writeFile(fixture, source)
  }
  await writeFile(patch, [
    '- id: agent-default-model', '  config:', '    provider: terminal-fixture', '    model: fixture',
    '- insert:', '    - id: terminal-fixture',
    `      name: ${pathToFileURL(fixture).href}`, '',
  ].join('\n'))
  const terminal: TerminalType = new Terminal({ cols: 140, rows: 44, allowProposedApi: true })
  let output = ''
  let prefix = ''
  let total = 0
  let alternateScreen = false
  let clearedScrollback = false
  const launch = (args: string[] = []) => spawn(executable, [
    ...externalCommand === undefined ? ['--import', pathToFileURL(cleanupProbe).href, ...entry] : [],
    '--profile', 'tui', '--backend-profile', 'terminal-backend', ...args,
  ], {
    cwd: home, cols: 140, rows: 44, name: 'xterm-256color',
    env: { ...process.env, ...invocation.env, DSH_HOME: home, DSH_PERMISSION_MODE: 'workspace-write',
      DSH_TELEMETRY_DISABLED: '1', NO_COLOR: '1' },
  })
  let child = launch()
  let exited = Promise.withResolvers<number>()
  const writes = new Set<Promise<void>>()
  const observe = (): void => {
    const completion = exited
    child.onExit(({ exitCode }) => { completion.resolve(exitCode) })
    child.onData((data) => {
      total += data.length
      if (prefix.length < 10000) prefix += data.slice(0, 10000 - prefix.length)
      if (total > 1000000) { child.kill(); return }
      output = (output + data).slice(-20000)
      alternateScreen ||= output.includes('\x1b[?1049h')
      clearedScrollback ||= output.includes('\x1b[3J')
      const write = new Promise<void>((resolve) => { terminal.write(data, resolve) })
      writes.add(write)
      void write.finally(() => { writes.delete(write) })
    })
  }
  observe()
  const screen = (): string => Array.from({ length: terminal.rows }, (_, index) =>
    terminal.buffer.active.getLine(terminal.buffer.active.viewportY + index)?.translateToString(true) ?? '').join('\n')
  const allText = (): string => Array.from({ length: terminal.buffer.normal.length }, (_, index) =>
    terminal.buffer.normal.getLine(index)?.translateToString(true) ?? '').join('\n')
  const launchUrl = async (): Promise<string> => {
    child.write('/web\r')
    await expect.poll(screen, { timeout: 20000 }).toContain('Browser sign-in link')
    const value = screen().match(/(http:\/\/[^\s]+token=[^\s]+)/u)?.[1]
    child.write('\r')
    await expect.poll(screen, { timeout: 20000 }).not.toContain('Browser sign-in link')
    if (value === undefined) throw new Error('Terminal did not show its sign-in link')
    return value
  }
  const latestSession = (): string | undefined => [...allText().matchAll(/DeepSeek Harness · (session-[a-z0-9-]+)/gu)].at(-1)?.[1]
  try {
    await expect.poll(() => screen(), { timeout: 20000 }).toContain('Web: http:')
    await expect.poll(() => screen(), { timeout: 20000 }).not.toContain('choose a conversation')
    await expect.poll(() => screen(), { timeout: 20000 }).toContain('Reasoning: high')
    expect(terminal.buffer.active).toBe(terminal.buffer.normal)
    expect(prefix).not.toContain('\x1b[?1049h')
    expect(screen()).not.toContain('token=')
    let url = await launchUrl()
    const authentication = await fetch(url, { redirect: 'manual' })
    expect(authentication.status).toBe(303)
    let cookie = authentication.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    const response = await fetch(new URL('/', url), { headers: { cookie } })
    expect(response.status).toBe(200)
    const sessionId = screen().match(/session-[a-z0-9-]+/u)?.[0]
    if (sessionId === undefined) throw new Error('Missing Session identity')
    child.write('你好abc')
    await expect.poll(screen, { timeout: 20000 }).toContain('你好abc')
    const inputLine = terminal.buffer.active.getLine(terminal.buffer.active.baseY + terminal.buffer.active.cursorY)
    expect(inputLine?.translateToString(true).trimEnd()).toBe('你好abc')
    expect(terminal.buffer.active.cursorX).toBe(7)
    child.write('\x7f\x7f\x7f\x7f\x7f')
    const workspace = async (sessionIds: string[]): Promise<void> => {
      const response = await fetch(new URL('/api/workspace/create', url), {
        method: 'POST', headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'terminal-workspace', method: 'workspace/create',
          payload: { args: { request: { path: home } } } }),
      })
      const value: unknown = await response.json()
      expect(value).toMatchObject({ result: { ok: true, value: {
        created: false, workspace: { path: await realpath(home) },
      } } })
      expect(value).toHaveProperty('result.value.workspace.sessionIds', expect.arrayContaining(sessionIds))
    }
    await workspace([sessionId])
    child.write('edit ac\x1b[Db\r')
    await expect.poll(screen, { timeout: 20000 }).toContain('Reply to edit abc')
    child.write('\x1b[A')
    await expect.poll(() => terminal.buffer.active.getLine(
      terminal.buffer.active.baseY + terminal.buffer.active.cursorY)?.translateToString(true).trimEnd(),
    { timeout: 20000 }).toBe('edit abc')
    child.write('\x05\x15')
    child.write('\x1b[200~paste one\npaste two\x1b[201~')
    await expect.poll(screen, { timeout: 20000 }).toContain('paste two')
    expect(screen()).not.toContain('Reply to paste one')
    child.write('\r')
    await expect.poll(screen, { timeout: 20000 }).toMatch(/Reply to paste one[ \t]*\n[ \t]*paste two/u)
    child.write('/he')
    await expect.poll(screen, { timeout: 20000 }).toContain('Show commands and keyboard shortcuts')
    child.write('\t\r')
    await expect.poll(screen, { timeout: 20000 }).toContain('Ctrl-O tools')
    child.write('\r')
    await expect.poll(screen, { timeout: 20000 }).not.toContain('Ctrl-O tools')
    child.write('read @sample')
    await expect.poll(screen, { timeout: 20000 }).toContain('sample file.md')
    child.write('\t\r')
    await expect.poll(screen, { timeout: 20000 }).toContain('Reply to read @"sample file.md"')
    child.write('markdown\r')
    await expect.poll(screen, { timeout: 20000 }).toContain('const answer = 42')
    expect(screen()).toContain('Terminal heading')
    expect(screen()).not.toContain('# Terminal heading')
    expect(screen()).not.toContain('**Bold result**')
    const browserMessage = await fetch(new URL('/api/session/prompt', url), {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'terminal-browser-test', method: 'session/prompt',
        payload: { args: { request: { requestId: 'browser-prompt', sessionId, mode: 'queue',
          content: [{ type: 'text', text: 'browser' }] } } } }),
    })
    const receipt: unknown = await browserMessage.json()
    expect(receipt).toMatchObject({ result: { ok: true, value: { accepted: true } } })
    await expect.poll(screen, { timeout: 20000 }).toContain('Reply to browser')
    await expect.poll(screen, { timeout: 20000 }).toContain('Cache: 75%')
    child.write('/model\r')
    await expect.poll(screen, { timeout: 20000 }).toContain('Select model ·')
    child.write('\x1b[B\r')
    await expect.poll(screen, { timeout: 20000 }).toContain('Model: terminal-fixture/alternate')
    child.write('/reasoning\r')
    await expect.poll(screen, { timeout: 20000 }).toContain('Reasoning · alternate')
    child.write('\x1b[B\r')
    await expect.poll(screen, { timeout: 20000 }).toContain('Reasoning: high')
    expect(screen()).toContain('Terminal fixture model listing')
    child.write('selection\r')
    await expect.poll(screen, { timeout: 20000 }).toContain('Selected alternate / high')
    const browserSelection = await fetch(new URL('/api/session/selectModel', url), {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'terminal-browser-selection', method: 'session/selectModel',
        payload: { args: { request: { sessionId, provider: 'terminal-fixture', model: 'fixture', reasoningEffort: 'low' } } } }),
    })
    expect(await browserSelection.json()).toMatchObject({ result: { ok: true } })
    await expect.poll(screen, { timeout: 20000 }).toContain('Model: terminal-fixture/fixture · Reasoning: low')
    child.write('/stats\x13')
    await expect.poll(screen, { timeout: 20000 }).toContain('Whole session · provider-reported token usage')
    expect(screen()).toContain('Cache: 75%')
    child.write('\r')
    await expect.poll(screen, { timeout: 20000 }).not.toContain('Whole session · provider-reported token usage')
    child.write('hello\r')
    await expect.poll(screen, { timeout: 20000 }).toContain('Reply to hello')
    child.write('你好\x1b[13;2u第二行\r')
    await expect.poll(screen, { timeout: 20000 }).toMatch(/Reply to 你好[ \t│]*\n[ \t│]*第二行/u)
    child.write('xterm\x1b[27;2;13~newline\r')
    await expect.poll(screen, { timeout: 20000 }).toMatch(/Reply to xterm[ \t│]*\n[ \t│]*newline/u)
    child.write('question\r')
    // Tool arguments expose the question before the modal takes keyboard focus.
    await expect.poll(screen, { timeout: 20000 }).toMatch(/(?:^|\n)Choose a color[ \t]*\n/u)
    child.write('\r')
    await expect.poll(screen, { timeout: 20000 }).toContain('Reply to question')
    child.write('free-question\r')
    await expect.poll(screen, { timeout: 20000 }).toMatch(/(?:^|\n)Describe the change[ \t]*\n/u)
    child.write('first\x1b[13;2usecond\r')
    await expect.poll(screen, { timeout: 20000 }).toContain('Reply to free-question')
    child.write('reject\r')
    await expect.poll(screen, { timeout: 20000 }).toContain('Allow bash?')
    child.write('\r')
    await expect.poll(screen, { timeout: 20000 }).toContain('Reply to reject')
    await expect(readFile(join(home, 'tui-proof.txt'), 'utf8')).rejects.toThrow()
    child.write('approve\r')
    await expect.poll(screen, { timeout: 20000 }).toContain('Allow bash?')
    child.write('\x1b[B\r')
    await expect.poll(screen, { timeout: 20000 }).toContain('Reply to approve')
    expect(await readFile(join(home, 'tui-proof.txt'), 'utf8')).toBe('tui-proof')
    child.write('/tools\r')
    await expect.poll(screen, { timeout: 20000 }).toContain('Tool activity ·')
    child.write('Bash(')
    await expect.poll(screen, { timeout: 20000 }).toContain('Find: Bash(')
    child.write('\r')
    await expect.poll(screen, { timeout: 20000 }).toContain('printf tui-proof')
    child.write('\r')
    await expect.poll(screen, { timeout: 20000 }).toContain('Message · Enter send')
    child.write('draft留着\x12')
    await expect.poll(screen, { timeout: 20000 }).toContain('Conversations ·')
    child.write('\x1b')
    await expect.poll(() => terminal.buffer.active.getLine(
      terminal.buffer.active.baseY + terminal.buffer.active.cursorY)?.translateToString(true).trimEnd(),
    { timeout: 20000 }).toBe('draft留着')
    child.write('\x15')
    child.write('wait\r')
    await expect.poll(screen, { timeout: 20000 }).toContain('Waiting for cancellation')
    child.write('\x03')
    await expect.poll(screen, { timeout: 20000 }).toContain('aborted')
    child.write('\x11')
    expect(await exited.promise).toBe(0)
    expect(output).toContain('Console restored: true')
    expect(output).toContain('\x1b[?2004l')
    if (prefix.includes('\x1b[>7u')) expect(output).toContain('\x1b[<u')
    await expect(fetch(new URL('/', url))).rejects.toThrow()
    await Promise.all(writes)
    terminal.reset()
    exited = Promise.withResolvers<number>()
    child = launch(['--session', sessionId])
    observe()
    await expect.poll(screen, { timeout: 20000 }).toContain('Waiting for cancellation')
    expect(allText()).toContain(sessionId)
    await expect.poll(screen, { timeout: 20000 }).toContain('Cache: 75%')
    expect(screen()).toContain('Reasoning: low')
    child.write('again\r')
    await expect.poll(screen, { timeout: 20000 }).toContain('Reply to again')
    await expect.poll(screen, { timeout: 20000 }).not.toContain('Working…')
    const restoredUrl = await launchUrl()
    url = restoredUrl
    const restoredAuth = await fetch(url, { redirect: 'manual' })
    cookie = restoredAuth.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    await expect.poll(screen, { timeout: 20000 }).toContain('Balance: 未提供')
    const rendered = screen().replaceAll(sessionId, '<session>').replaceAll(await realpath(home), '<cwd>').replaceAll(home, '<cwd>')
      .replace(/Web: http:\/\/\S+ ·/u, 'Web: <origin> ·').replace(/ {2,}(?=DeepSeek Harness|<cwd>|Web: )/gu, '  ')
      .replace(/Output: (?:[\d.]+ tok\/s|未提供)/gu, 'Output: <speed> tok/s')
      .split('\n').map(line => line.trimEnd()).join('\n').replace(/\n+$/u, '') + '\n'
    await expect(rendered).toMatchFileSnapshot('./expected/conversation.txt')
    terminal.resize(80, 24)
    child.resize(80, 24)
    await expect.poll(screen, { timeout: 20000 }).toContain('Model: terminal-fixture/fixture · Reasoning: low')
    expect(screen()).toContain('Cache: 75%')
    expect(screen()).toContain('Balance: 未提供')
    expect(screen()).toContain('Message · Enter send')
    child.write('\x0e')
    await expect.poll(latestSession, { timeout: 20000 }).not.toBe(sessionId)
    const secondId = latestSession()
    if (secondId === undefined) throw new Error('Missing second Session identity')
    await workspace([sessionId, secondId])
    child.write('\x1b[110;5u')
    await expect.poll(latestSession, { timeout: 20000 }).not.toBe(secondId)
    const thirdId = latestSession()
    if (thirdId === undefined) throw new Error('Missing third Session identity')
    await workspace([sessionId, secondId, thirdId])
    child.write('shortcut\r')
    await expect.poll(screen, { timeout: 20000 }).toContain('Reply to shortcut')
    expect(screen()).not.toContain('Reply to nshortcut')
    await mkdir(join(home, 'elsewhere'))
    const foreign = await fetch(new URL('/api/session/create', url), {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'terminal-foreign', method: 'session/create',
        payload: { args: { request: { cwd: join(home, 'elsewhere') } } } }),
    })
    const foreignId = ((await foreign.json()) as { result: { value: { sessionId: string } } }).result.value.sessionId
    for (let index = 0; index < 22; index++) {
      const response = await fetch(new URL('/api/session/create', url), {
        method: 'POST', headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: `terminal-history-${String(index)}`, method: 'session/create',
          payload: { args: { request: { cwd: home } } } }),
      })
      expect(await response.json()).toMatchObject({ result: { ok: true } })
    }
    child.write('\x12')
    await expect.poll(screen, { timeout: 20000 }).toContain('Conversations ·')
    await expect.poll(screen, { timeout: 20000 }).toContain('New conversation')
    expect(screen().split('\n').filter(line => line.includes('session-')).length).toBeLessThanOrEqual(9)
    terminal.resize(100, 30)
    child.resize(100, 30)
    await expect.poll(screen, { timeout: 20000 }).toContain('Find:')
    child.write(foreignId.slice(-12))
    await expect.poll(screen, { timeout: 20000 }).toContain('No matches')
    child.write('\x7f'.repeat(12))
    await expect.poll(screen, { timeout: 20000 }).not.toContain('No matches')
    child.write(sessionId.slice(-12))
    await expect.poll(screen, { timeout: 20000 }).toContain(`Find: ${sessionId.slice(-12)}`)
    expect(screen()).not.toContain('No matches')
    child.write('\r')
    await expect.poll(latestSession, { timeout: 20000 }).toBe(sessionId)
    expect(terminal.buffer.normal.baseY).toBeGreaterThan(0)
    expect(allText()).toContain('Reply to browser')
    expect(alternateScreen).toBe(false)
    expect(clearedScrollback).toBe(false)
    expect(allText()).toContain('SHELL_HISTORY_SENTINEL')
    child.write('\x11')
    expect(await exited.promise).toBe(0)
    const external = execa(executable, [...entry, '--profile', 'terminal-backend', '--no-open', '--port', '0'], {
      cwd: home, env: { ...process.env, ...invocation.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }, reject: false,
    })
    let backendOutput = ''
    external.stdout.on('data', (data: Buffer) => { backendOutput += data.toString() })
    try {
      await expect.poll(() => backendOutput, { timeout: 20000 }).toMatch(/dsh web: http:\/\/[^\s]+/u)
      const launchUrl = /dsh web: (http:\/\/[^\s]+)/u.exec(backendOutput)?.[1]
      if (launchUrl === undefined) throw new Error('External backend did not expose its URL')
      terminal.reset()
      exited = Promise.withResolvers<number>()
      child = launch(['--connect', launchUrl])
      observe()
      await expect.poll(screen, { timeout: 20000 }).toContain('Web: http:')
      child.write('external backend\r')
      await expect.poll(screen, { timeout: 20000 }).toContain('Reply to external backend')
      child.write('\x11')
      expect(await exited.promise).toBe(0)
      expect((await fetch(launchUrl, { redirect: 'manual' })).status).toBe(303)
    } finally {
      external.kill('SIGTERM')
      await external
    }
  } catch (error) {
    throw new Error(`${String(error)}\n${screen()}\n${prefix}\n${output.slice(-5000)}`)
  } finally {
    child.kill()
    await exited.promise
    await Promise.all(writes)
    terminal.dispose()
    await rm(home, { recursive: true, force: true })
  }
})

it('prints terminal help and rejects invalid ports and redirected input before starting a server', async ({ signal }) => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-tui-help-'))
  await prepareTerminalProfile(home)
  const invoke = (args: string[]) => execa(executable, [
    ...entry, 'tui', ...args,
  ], {
    cwd: home, env: { ...process.env, ...invocation.env, DSH_HOME: home,
      DSH_TELEMETRY_DISABLED: '1' }, reject: false, cancelSignal: signal,
  })
  try {
    const help = await invoke(['--help'])
    expect(help.exitCode).toBe(0)
    expect(help.stdout).toContain('Usage: dsh tui')
    expect(help.stdout).toContain('--session')
    const invalid = await invoke(['--port', '65536'])
    expect(invalid.exitCode).toBe(1)
    expect(invalid.stderr).toContain('--port must be an integer')
    const redirected = await invoke([])
    expect(redirected.exitCode).toBe(1)
    expect(redirected.stderr).toContain('requires an interactive terminal')
    expect(redirected.stdout).not.toContain('dsh web:')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
