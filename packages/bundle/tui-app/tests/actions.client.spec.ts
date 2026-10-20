/** Archive failures preserve existing files and remove incomplete downloads. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
import { askExportPath, browseTools, exportArchive, manageQueue } from '../src/actions.ts'
import type { TerminalView, ToolCall } from '../src/transcript.ts'
import type { Choice } from '../src/ui.ts'
import { TerminalLocale } from '../src/locale.ts'
import { ConversationId, PendingMessageId, type PendingMessage } from '../src/port.ts'

it('streams bytes, refuses overwrite, and removes an owned partial file after failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tui-export-'))
  try {
    const path = join(directory, 'log.zip')
    const signal = new AbortController().signal
    const source = { async *exportLog() { yield Uint8Array.of(80, 75); yield Uint8Array.of(3, 4) } }
    await exportArchive(source, ConversationId('test'), path, signal)
    expect(await readFile(path)).toEqual(Buffer.from([80, 75, 3, 4]))
    await expect(exportArchive(source, ConversationId('test'), path, signal)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(path)).toEqual(Buffer.from([80, 75, 3, 4]))
    const partial = join(directory, 'partial.zip')
    await expect(exportArchive({ async *exportLog() { yield Uint8Array.of(80); throw new Error('disconnected') } }, ConversationId('test'), partial, signal)).rejects.toThrow('disconnected')
    await expect(readFile(partial)).rejects.toMatchObject({ code: 'ENOENT' })
    await writeFile(partial, 'untouched')
    await expect(exportArchive(source, ConversationId('test'), partial, signal)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(partial, 'utf8')).toBe('untouched')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('trims the export destination, expands the home directory, and treats blank input as dismissal', async () => {
  const signal = new AbortController().signal
  const ask = vi.fn(async (_title: string, _signal: AbortSignal, _initial?: string): Promise<string | undefined> => '  ~/logs/a.zip \n')
  const ui = { ask, locale: new TerminalLocale() }
  expect(await askExportPath(ui, ConversationId('a/b'), signal)).toBe(join(homedir(), 'logs', 'a.zip'))
  expect(ask).toHaveBeenCalledWith(expect.any(String), signal, expect.stringMatching(/dsh-a_b\.zip$/u))
  ask.mockResolvedValueOnce('   ')
  expect(await askExportPath(ui, ConversationId('a'), signal)).toBeUndefined()
  ask.mockResolvedValueOnce(undefined)
  expect(await askExportPath(ui, ConversationId('a'), signal)).toBeUndefined()
  ask.mockResolvedValueOnce('/tmp/exports/a.zip')
  expect(await askExportPath(ui, ConversationId('a'), signal)).toBe('/tmp/exports/a.zip')
})

const tool = (id: string, state: ToolCall['state'], details: string, extra: Partial<ToolCall> = {}): ToolCall =>
  ({ id, title: `Bash(${id})`, state, detail: [], details, ...extra })
const view = (calls: ToolCall[]): TerminalView => ({ live: '', working: false, activity: { calls: 0, failed: 0 },
  entries: [{ id: 'tools', seq: 1, kind: 'tools', text: '', group: { calls, count: calls.length, failed: 0 } },
    { id: 'reply', seq: 2, kind: 'assistant', text: 'ok' }] })

it('browses newest calls first, filters failures, splits arguments from output, and keeps the selection', async () => {
  const answers: (number | undefined)[] = [1, 2, 0, 1, 9, undefined]
  const choose = vi.fn(async (_title: string, _choices: readonly Choice[], _signal: AbortSignal, _initial?: number) => answers.shift())
  const viewed = vi.fn(async (_title: string, _body: string, _signal: AbortSignal) => {})
  const calls = [tool('a', 'done', '{"x":1}\n\nout a', { argumentLength: 7 }), tool('b', 'failed', '{}', { argumentLength: 2, truncated: true }),
    tool('c', 'running', 'partial')]
  await browseTools({ locale: new TerminalLocale(), choose, view: viewed }, view(calls), new AbortController().signal)
  expect(choose.mock.calls[0]?.[1]).toEqual(['Show failed calls only', '… Bash(c)', '✗ Bash(b)', '✓ Bash(a)'])
  expect(viewed.mock.calls[0]).toEqual(['Bash(c)', 'Arguments\n\n\nOutput\npartial', expect.anything()])
  expect(choose.mock.calls[1]?.[3]).toBe(1)
  expect(viewed.mock.calls[1]?.[1]).toBe('Arguments\n{}\n\nOutput\nNo text output\n\nOutput truncated · /export downloads the complete log')
  expect(choose.mock.calls[3]?.[1]).toEqual(['Show all calls', '✗ Bash(b)'])
  expect(viewed).toHaveBeenCalledTimes(3)
  const aborted = new AbortController()
  aborted.abort()
  await browseTools({ locale: new TerminalLocale(), choose, view: viewed }, view([]), aborted.signal)
  expect(choose).toHaveBeenCalledTimes(6)
})

it('edits, removes, and steers pending messages until none remain or the list is dismissed', async () => {
  const one: PendingMessage = { id: PendingMessageId('m1'), text: 'first', target: 'next-turn' }
  const two: PendingMessage = { id: PendingMessageId('m2'), text: 'second', target: 'next-step' }
  const queue = vi.fn(async (_id: ConversationId, _signal: AbortSignal): Promise<PendingMessage[]> => [one, two])
  const updateQueue = vi.fn(async () => {})
  const picks: (number | undefined)[] = [0, 0, 1, 1, 0, 2, 0, 0, 0, undefined, undefined]
  const choose = vi.fn(async (_title: string, _choices: readonly Choice[], _signal: AbortSignal) => picks.shift())
  const edits: (string | undefined)[] = ['edited', '   ']
  const ask = vi.fn(async (_title: string, _signal: AbortSignal, _initial?: string) => edits.shift())
  const status = vi.fn()
  const ui = { locale: new TerminalLocale(), choose, ask, status }
  await manageQueue(ui, { queue, updateQueue }, ConversationId('s'), new AbortController().signal)
  expect(choose.mock.calls[0]?.[1]).toEqual(['⌛ first', '↳ second'])
  expect(ask).toHaveBeenCalledWith('Edit pending message', expect.anything(), 'first')
  expect(updateQueue.mock.calls).toEqual([[ConversationId('s'), one.id, { kind: 'edit', text: 'edited' }],
    [ConversationId('s'), two.id, { kind: 'remove' }], [ConversationId('s'), one.id, { kind: 'steer' }]])
  queue.mockResolvedValueOnce([])
  await manageQueue(ui, { queue, updateQueue }, ConversationId('s'), new AbortController().signal)
  expect(status).toHaveBeenCalledWith('No pending messages')
})
