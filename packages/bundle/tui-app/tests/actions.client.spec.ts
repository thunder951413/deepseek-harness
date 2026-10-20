/** Archive failures preserve existing files and remove incomplete downloads. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { expect, it, vi } from 'vitest'
import { askExportPath, exportArchive } from '../src/actions.ts'
import { TerminalLocale } from '../src/locale.ts'
import { SessionId } from '../src/port.ts'

it('streams bytes, refuses overwrite, and removes an owned partial file after failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tui-export-'))
  try {
    const path = join(directory, 'log.zip')
    const signal = new AbortController().signal
    const source = { async *exportLog() { yield Uint8Array.of(80, 75); yield Uint8Array.of(3, 4) } }
    await exportArchive(source, SessionId('test'), path, signal)
    expect(await readFile(path)).toEqual(Buffer.from([80, 75, 3, 4]))
    await expect(exportArchive(source, SessionId('test'), path, signal)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(path)).toEqual(Buffer.from([80, 75, 3, 4]))
    const partial = join(directory, 'partial.zip')
    await expect(exportArchive({ async *exportLog() { yield Uint8Array.of(80); throw new Error('disconnected') } }, SessionId('test'), partial, signal)).rejects.toThrow('disconnected')
    await expect(readFile(partial)).rejects.toMatchObject({ code: 'ENOENT' })
    await writeFile(partial, 'untouched')
    await expect(exportArchive(source, SessionId('test'), partial, signal)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(partial, 'utf8')).toBe('untouched')
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('trims the export destination, expands the home directory, and treats blank input as dismissal', async () => {
  const signal = new AbortController().signal
  const ask = vi.fn(async (_title: string, _signal: AbortSignal, _initial?: string): Promise<string | undefined> => '  ~/logs/a.zip \n')
  const ui = { ask, locale: new TerminalLocale() }
  expect(await askExportPath(ui, SessionId('a/b'), signal)).toBe(join(homedir(), 'logs', 'a.zip'))
  expect(ask).toHaveBeenCalledWith(expect.any(String), signal, expect.stringMatching(/dsh-a_b\.zip$/u))
  ask.mockResolvedValueOnce('   ')
  expect(await askExportPath(ui, SessionId('a'), signal)).toBeUndefined()
  ask.mockResolvedValueOnce(undefined)
  expect(await askExportPath(ui, SessionId('a'), signal)).toBeUndefined()
})
