/** Locale-independent usage figures shared by the browser and terminal. */
import { describe, expect, it } from 'vitest'
import { formatCacheHitPercent, formatTokensPerSecond } from '../src/format.ts'

describe('formatCacheHitPercent', () => {
  it('has no figure without prompt input and reports an exact full hit', () => {
    expect(formatCacheHitPercent(0, 0)).toBeNull()
    expect(formatCacheHitPercent(100, 100)).toBe('100')
  })

  it('rounds ordinary ratios, omitting a redundant decimal zero', () => {
    expect(formatCacheHitPercent(60, 100)).toBe('60')
    expect(formatCacheHitPercent(1, 3)).toBe('33')
    expect(formatCacheHitPercent(1, 3, 1)).toBe('33.3')
    expect(formatCacheHitPercent(1, 2, 1)).toBe('50')
    expect(formatCacheHitPercent(1, 200)).toBe('1')
    expect(formatCacheHitPercent(1, 400)).toBe('0')
  })

  it('never rounds a partial hit up to 100', () => {
    expect(formatCacheHitPercent(999, 1000)).toBe('99.9')
    expect(formatCacheHitPercent(9999, 10000)).toBe('99.99')
    expect(formatCacheHitPercent(995, 1000)).toBe('99.5')
    expect(formatCacheHitPercent(99_999, 100_000, 1)).toBe('99.999')
    expect(formatCacheHitPercent(999_991, 1_000_000)).toBe('99.999')
    expect(formatCacheHitPercent(999_997, 1_000_000)).toBe('99.9997')
    expect(formatCacheHitPercent(999_999, 1_000_000)).toBe('99.9999')
    expect(formatCacheHitPercent(9996, 10_000)).toBe('99.96')
  })
})

describe('formatTokensPerSecond', () => {
  it('uses whole tokens from ten up and one decimal below', () => {
    expect(formatTokensPerSecond(34.4)).toBe('34')
    expect(formatTokensPerSecond(9.96)).toBe('10')
    expect(formatTokensPerSecond(3.14)).toBe('3.1')
    expect(formatTokensPerSecond(-1)).toBe('0')
  })
})
