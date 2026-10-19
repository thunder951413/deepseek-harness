import type { ChatViewSlotProps } from '../contract/slots.ts'

/**
 * Compact token count: 517 / 12.2K / 517K / 1.2M.
 * @param value - non-negative token count.
 * @param t - Chat locale seat.
 * @returns locale-owned compact display string.
 */
export function formatTokens(value: number, t: ChatViewSlotProps['t']): string {
  const scaled = (candidate: number): string =>
    candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return t('number.thousand', { value: scaled(value / 1_000) })
  return t('number.million', { value: scaled(value / 1_000_000) })
}

/**
 * Exact integer token count with locale-owned digit grouping.
 * @param value - non-negative safe integer token count.
 * @param t - Chat locale seat.
 * @returns an unrounded display string.
 */
export function formatExactTokens(value: number, t: ChatViewSlotProps['t']): string {
  const digits = String(value)
  const groups: string[] = []
  for (let end = digits.length; end > 0; end -= 3) {
    groups.unshift(digits.slice(Math.max(0, end - 3), end))
  }
  return groups.join(t('number.groupSeparator'))
}

export { formatCacheHitPercent } from '@deepseek-ai/dsh-token-meter/client'
