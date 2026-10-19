/** Usage accounting and unavailable readings retain the browser's semantics. */
import { expect, it } from 'vitest'
import { balanceText, sessionReadings } from '../src/readings.ts'

it('uses disjoint billing buckets and decode time, preserving mixed-currency wallet precision', () => {
  const values = {
    usage: { uncachedInput: 20, cacheRead: 60, cacheWrite: 20, output: 40 },
    stats: { turns: 1, steps: 1, ttftMs: 3000, ttftSteps: 1, decodeMs: 2000, decodeTokens: 40 },
  }
  const reading = sessionReadings(values, { provider: 'test', model: 'model', reasoningEffort: 'high' }, {
    status: 'ready', wallets: [{ currency: 'CNY', balance: '12.3400' }, { currency: 'USD', balance: '0.02' }],
    bonusWallets: [{ currency: 'CNY', balance: '1.50' }],
  })
  expect(reading.compact).toContain('Cache: 60% · Output: 20 tok/s')
  expect(reading.compact).toContain('CNY 12.3400 + USD 0.02 + CNY 1.50 bonus')
  expect(reading.details).toContain('Input: 100 · Output: 40')
  expect(reading.details).toContain('Average first token: 3000 ms')
})

it('distinguishes absent usage, empty usage, wallet failure, and a genuine full cache hit', () => {
  expect(sessionReadings({}, undefined, null).compact).toContain('Cache: 未提供 · Output: 未提供')
  expect(balanceText({ status: 'failed' })).toContain('Query failed')
  expect(balanceText('loading')).toBe('Loading…')
  expect(balanceText({ status: 'ready', wallets: [], bonusWallets: [] })).toBe('未提供')
  const usage = { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
  expect(sessionReadings({ usage }, undefined, null).compact).toContain('Cache: 未提供')
  expect(sessionReadings({ usage: { ...usage, cacheRead: 100 } }, undefined, null).compact).toContain('Cache: 100%')
  expect(sessionReadings({ usage: { ...usage, cacheRead: 999, uncachedInput: 1 } }, undefined, null).compact).toContain('Cache: 99.9%')
})
