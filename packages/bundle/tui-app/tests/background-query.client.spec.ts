/** The background query waits only for the device attributes answer and restores the input stream. */
import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { queryBackground, type QueryInput } from '../src/background-query.ts'

function terminal(answer: string | string[] | undefined, raw = false) {
  const events = new EventEmitter()
  const modes: boolean[] = []
  const pause = vi.fn()
  const input: QueryInput = {
    isTTY: true, isRaw: raw,
    setRawMode: (mode) => { modes.push(mode) }, resume: vi.fn(), pause,
    on: (event, listener) => events.on(event, listener), off: (event, listener) => events.off(event, listener),
  }
  const written: string[] = []
  const output = { isTTY: true, write: (text: string) => {
    written.push(text)
    for (const [index, chunk] of [answer ?? []].flat().entries()) setTimeout(() => { events.emit('data', Buffer.from(chunk)) }, index * 5)
  } }
  return { input, output, modes, written, events, pause }
}

it('returns the reported background and restores raw mode and the stream', async () => {
  const { input, output, modes, written, events, pause } = terminal('\u001b]11;rgb:ffff/ffff/ffff\u0007\u001b[?62;c')
  expect(await queryBackground(input, output, 1000)).toEqual([255, 255, 255])
  expect(written).toEqual(['\u001b]11;?\u0007\u001b[c'])
  expect(modes).toEqual([true, false])
  expect(pause).toHaveBeenCalled()
  expect(events.listenerCount('data')).toBe(0)
})

it('collects an answer that arrives in several chunks before the attributes reply', async () => {
  const { input, output } = terminal(['\u001b]11;rgb:1c1c/2020/', '2828\u0007', '\u001b[?1;2c'])
  expect(await queryBackground(input, output, 1000)).toEqual([28, 32, 40])
})

it('does not wait for the timeout when the terminal only answers the attributes query', async () => {
  const { input, output } = terminal('\u001b[?1;2c')
  const started = Date.now()
  expect(await queryBackground(input, output, 5000)).toBeUndefined()
  expect(Date.now() - started).toBeLessThan(1000)
})

it('gives up after the timeout when nothing answers and keeps a stream that was already raw', async () => {
  const { input, output, modes } = terminal(undefined, true)
  expect(await queryBackground(input, output, 20)).toBeUndefined()
  expect(modes).toEqual([true, true])
})

it('does nothing unless both streams are terminals', async () => {
  const { input, output, written } = terminal(undefined)
  expect(await queryBackground({ ...input, isTTY: false }, output)).toBeUndefined()
  expect(await queryBackground(input, { ...output, isTTY: false })).toBeUndefined()
  expect(written).toEqual([])
})
