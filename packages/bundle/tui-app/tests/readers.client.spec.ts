/** Tolerant readers accept additive wire changes and degrade malformed optional data. */
import { expect, it } from 'vitest'
import {
  readQueue, readSearch, readSkills, json, readBalance, readCatalog, readControlFrame, readCreated, readFollowFrame, readReadings,
  readSessionList, readWorkspaceId,
} from '../src/readers.ts'

it('keeps plain JSON and replaces members that cannot be serialized', () => {
  expect(json({ a: [1, 'b', null, true], c: Number.NaN, d: undefined })).toEqual({ a: [1, 'b', null, true], c: null, d: null })
  expect(json(() => 1)).toBeNull()
})

it('reads conversations newest first and ignores delegated rows, extra fields, and rows without identity', () => {
  const rows = readSessionList({ items: [
    { sessionId: 'a', updatedAt: 1, running: true, cwd: '/p', projections: { values: { title: 'First' } }, future: { x: 1 } },
    { sessionId: 'b', updatedAt: 5 },
    { sessionId: 'c', origin: 'subagent', updatedAt: 9 },
    { updatedAt: 3 }, { sessionId: 'd' },
  ] })
  expect(rows).toEqual([{ id: 'b', updatedAt: 5, running: false }, { id: 'a', updatedAt: 1, running: true, cwd: '/p', title: 'First' },
    { id: 'd', updatedAt: 0, running: false }])
  expect(() => readSessionList({ items: 'not-a-list' })).toThrow('incompatible')
})

it('reads created identities and Workspace identities', () => {
  expect(readCreated({ sessionId: 's1', agentPreset: 'x' })).toBe('s1')
  expect(readCreated({})).toBeUndefined()
  expect(readWorkspaceId({ workspace: { workspaceId: 'w1' } })).toBe('w1')
  expect(readWorkspaceId(null)).toBeUndefined()
})

it('reads follow frames and ignores unknown or malformed frames', () => {
  expect(readFollowFrame({ type: 'snapshot', header: { cwd: '/p' }, records: [
    { type: 'event', event: { type: 'turn/start', seq: 1, time: 0, data: {} } }, { event: { type: 5 } }, 'junk',
  ], assistantStream: { activeAttempt: { stream: [{ type: 'text-chunks', texts: ['hi'] }] } } })).toEqual({
    kind: 'snapshot', cwd: '/p', events: [{ type: 'turn/start', seq: 1, data: {} }], active: [{ type: 'text-chunks', texts: ['hi'] }],
  })
  expect(readFollowFrame({ type: 'snapshot' })).toEqual({ kind: 'snapshot', events: [] })
  expect(readFollowFrame({ type: 'event', event: { type: 'turn/end', seq: 2, data: { reason: { kind: 'completed' } } } }))
    .toEqual({ kind: 'event', event: { type: 'turn/end', seq: 2, data: { reason: { kind: 'completed' } } } })
  expect(readFollowFrame({ type: 'event', event: {} })).toBeUndefined()
  expect(readFollowFrame({ type: 'assistant-stream', frame: { type: 'start', attemptId: 'x' } })).toEqual({ kind: 'stream', frame: { type: 'start' } })
  expect(readFollowFrame({ type: 'assistant-stream', frame: { type: 'end' } })).toEqual({ kind: 'stream', frame: { type: 'end' } })
  expect(readFollowFrame({ type: 'assistant-stream', frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'a' } } }))
    .toEqual({ kind: 'stream', frame: { type: 'chunk', chunk: { type: 'text-delta', text: 'a' } } })
  expect(readFollowFrame({ type: 'assistant-stream', frame: { type: 'future' } })).toBeUndefined()
  expect(readFollowFrame({ type: 'future-kind' })).toBeUndefined()
})

it('reads readings and treats missing or malformed members as unreported', () => {
  const usage = { uncachedInputTokens: 1, cacheReadTokens: 2, cacheWriteTokens: 3, outputTokens: 4 }
  const stats = { turns: 1, steps: 2, ttftMs: 3, ttftSteps: 4, decodeMs: 5, decodeTokens: 6, extra: 1 }
  expect(readReadings({ kind: 'sequenced', values: { tokenUsage: usage, sessionStats: stats,
    modelSelection: { next: { provider: 'p', model: 'm', reasoningEffort: 'high' } } } })).toEqual({ kind: 'values', readings: {
    next: { provider: 'p', model: 'm', reasoningEffort: 'high' },
    usage: { uncachedInput: 1, cacheRead: 2, cacheWrite: 3, output: 4 },
    stats: { turns: 1, steps: 2, ttftMs: 3, ttftSteps: 4, decodeMs: 5, decodeTokens: 6 },
  } })
  expect(readReadings({ kind: 'sequenced', values: { tokenUsage: { cacheReadTokens: 2 }, sessionStats: { turns: 1 },
    modelSelection: { next: { provider: 'p' } } } })).toEqual({ kind: 'values', readings: {} })
  expect(readReadings({ kind: 'migration-required', values: {} })).toEqual({ kind: 'migration-required', readings: {} })
  expect(readReadings(null)).toBeUndefined()
  expect(readReadings({ kind: 'future' })).toBeUndefined()
})

it('reads live change frames', () => {
  expect(readControlFrame({ type: 'baseline', value: {} })).toEqual({})
  expect(readControlFrame({ type: 'projection', sessionId: 's', key: 'tokenUsage', value: 1, seq: 2 })).toEqual({ sessionId: 's', key: 'tokenUsage' })
  expect(readControlFrame({ type: 'projection' })).toBeUndefined()
  expect(readControlFrame({ type: 'future' })).toBeUndefined()
})

it('reads the model directory with defaults for absent names and drops rows without identity', () => {
  expect(readCatalog({
    default: { provider: 'p', model: 'm' },
    groups: [{ id: 'p', name: 'Provider', models: [
      { id: 'm', reasoning: { efforts: [{ id: 'low', name: 'Low', description: 'fast' }, { id: 'high' }, { name: 'x' }], defaultEffort: 'low' } },
      { name: 'no id' }, { id: 'plain', name: 'Plain' },
    ] }, { name: 'no id' }, { id: 'bare' }],
    failures: [{ id: 'q', message: 'down' }, { name: 'r' }, {}],
  })).toEqual({
    default: { provider: 'p', model: 'm' },
    groups: [
      { id: 'p', name: 'Provider', models: [
        { id: 'm', name: 'm', efforts: [{ id: 'low', name: 'Low', description: 'fast' }, { id: 'high', name: 'high' }], defaultEffort: 'low' },
        { id: 'plain', name: 'Plain', efforts: [] },
      ] },
      { id: 'bare', name: 'bare', models: [] },
    ],
    failures: [{ name: 'q', message: 'down' }, { name: 'r', message: 'lookup failed' }, { name: 'provider', message: 'lookup failed' }],
  })
  expect(readCatalog(undefined)).toEqual({ groups: [], failures: [] })
})

it('reads balances, preserving decimal strings and treating unknown statuses as failures', () => {
  expect(readBalance(null)).toBeNull()
  expect(readBalance(undefined)).toBeNull()
  expect(readBalance({ status: 'ready', value: [{ currency: 'CNY', balance: '1.2300' }, { currency: 'USD' }], bonusWallets: [{ currency: 'CNY', balance: '2' }] }))
    .toEqual({ status: 'ready', wallets: [{ currency: 'CNY', balance: '1.2300' }], bonusWallets: [{ currency: 'CNY', balance: '2' }] })
  expect(readBalance({ status: 'failed' })).toEqual({ status: 'failed' })
  expect(readBalance({ status: 'future' })).toEqual({ status: 'failed' })
})


it('only offers human text messages for queue editing and keeps their target', () => {
  expect(readQueue({ values: { inbox: { 'next-turn': [
    { id: 'human', source: { kind: 'user' }, content: [{ type: 'text', text: 'queued' }] },
    { id: 'image', source: { kind: 'user' }, content: [{ type: 'image' }] },
    { id: 'tool', source: { kind: 'tool' }, content: [{ type: 'text', text: 'hidden' }] },
  ], 'next-step': [{ id: 'steering', source: { kind: 'user' }, content: [{ type: 'text', text: 'now' }] }] } } })).toEqual([
    { id: 'human', target: 'next-turn', text: 'queued' }, { id: 'steering', target: 'next-step', text: 'now' },
  ])
  expect(readQueue({ values: {} })).toBeUndefined()
  expect(readSearch({ items: [{ sessionId: 'a', snippet: 'match' }, {}], hasMore: true })).toEqual({ items: [{ id: 'a', snippet: 'match' }], hasMore: true })
})

it('reads skill names with descriptions and ignores entries without a name', () => {
  expect(readSkills({ skills: [{ name: 'a', description: 'Does a', modelInvocable: true }, { name: 'b' }, { description: 'nameless' }], more: 1 }))
    .toEqual([{ name: 'a', description: 'Does a' }, { name: 'b', description: '' }])
  expect(() => readSkills({ skills: 'none' })).toThrow('Invalid skill catalog')
})
