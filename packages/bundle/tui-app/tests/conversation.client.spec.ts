/** Conversation following projects port frames and stops at cancellation. */
import { expect, it } from 'vitest'
import { observe } from '../src/conversation.ts'
import { SessionId, type FollowFrame, type HarnessPort } from '../src/port.ts'

function port(frames: FollowFrame[]): Pick<HarnessPort, 'follow'> {
  return { follow: async function* () { yield* frames } }
}

it('opens from a snapshot, streams unfinished text, and flags turn completion', async () => {
  const updates = []
  for await (const update of observe(port([
    { kind: 'snapshot', events: [{ type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: 'hi' } }],
      active: [{ type: 'text-chunks', texts: ['part'] }] },
    { kind: 'stream', frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'ial' } } },
    { kind: 'event', event: { type: 'turn/end', seq: 2, data: { reason: { kind: 'completed' } } } },
  ]), SessionId('s'), 10, 1000, '/fallback', new AbortController().signal)) updates.push(update)
  expect(updates.map(update => update.directory)).toEqual(['/fallback', undefined, undefined])
  expect(updates[0]?.view.entries[0]?.text).toBe('hi')
  expect(updates[1]?.view.live).toBe('partial')
  expect(updates.map(update => update.turnEnded)).toEqual([false, false, true])
  expect(updates[2]?.view.working).toBe(false)
})

it('uses the snapshot directory and stops once aborted', async () => {
  const abort = new AbortController()
  const seen: string[] = []
  for await (const update of observe(port([
    { kind: 'snapshot', cwd: '/project', events: [] }, { kind: 'snapshot', events: [] },
  ]), SessionId('s'), 10, 1000, '/fallback', abort.signal)) {
    seen.push(update.directory ?? '')
    abort.abort()
  }
  expect(seen).toEqual(['/project'])
})

it('replaces the baseline on recovery and exposes omitted older history', async () => {
  const snapshot: FollowFrame = { kind: 'snapshot', hasMore: true, events: [
    { type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: 'one' } },
  ] }
  const updates = []
  for await (const update of observe(port([snapshot, snapshot]), SessionId('s'), 1, 1000, '/project', new AbortController().signal)) updates.push(update)
  expect(updates[1]?.view.entries).toHaveLength(1)
  expect(updates[1]?.view.truncated).toBe(true)
})
