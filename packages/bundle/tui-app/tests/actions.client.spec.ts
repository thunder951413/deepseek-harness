/** Archive failures preserve existing files and remove incomplete downloads. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { exportArchive } from '../src/actions.ts'
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
