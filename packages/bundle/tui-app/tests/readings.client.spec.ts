/** Usage accounting and unavailable readings retain the browser's semantics. */
import { expect, it } from 'vitest'
import { balanceText, cents, sessionReadings } from '../src/readings.ts'

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
  expect(reading.compact).toContain('CNY 12.34 + USD 0.02 + CNY 1.50 bonus')
  expect(reading.details).toContain('Input: 100 · Output: 40')
  expect(reading.details).toContain('Average first token: 3000 ms')
})

it('distinguishes absent usage, empty usage, wallet failure, and a genuine full cache hit', () => {
  expect(sessionReadings({}, undefined, null).compact).toContain('Cache: Unavailable · Output: Unavailable')
  expect(balanceText({ status: 'failed' })).toContain('Query failed')
  expect(balanceText('loading')).toBe('Loading…')
  expect(balanceText({ status: 'ready', wallets: [], bonusWallets: [] })).toBe('Unavailable')
  const usage = { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
  expect(sessionReadings({ usage }, undefined, null).compact).toContain('Cache: Unavailable')
  expect(sessionReadings({ usage: { ...usage, cacheRead: 100 } }, undefined, null).compact).toContain('Cache: 100%')
  expect(sessionReadings({ usage: { ...usage, cacheRead: 999, uncachedInput: 1 } }, undefined, null).compact).toContain('Cache: 99.9%')
})

it('rounds amounts to cents without floating point, halves away from zero, and keeps non-decimal text', () => {
  expect(cents('56.0568228600000000')).toBe('56.06')
  expect(cents('12.1950612000000000')).toBe('12.20')
  expect(cents('12.3400')).toBe('12.34')
  expect(cents('15')).toBe('15.00')
  expect(cents('0.004')).toBe('0.00')
  expect(cents('0.005')).toBe('0.01')
  expect(cents('9.995')).toBe('10.00')
  expect(cents('-0.004')).toBe('0.00')
  expect(cents('-2.345')).toBe('-2.35')
  expect(cents('123456789012345678.999')).toBe('123456789012345679.00')
  expect(cents('n/a')).toBe('n/a')
})

it('labels the banner model with its reasoning effort only when one is selected', () => {
  expect(sessionReadings({}, { provider: 'test', model: 'm', reasoningEffort: 'high' }, null).model).toBe('test/m · high')
  expect(sessionReadings({}, { provider: 'test', model: 'm' }, null).model).toBe('test/m')
  expect(sessionReadings({}, undefined, null).model).toBeUndefined()
})
