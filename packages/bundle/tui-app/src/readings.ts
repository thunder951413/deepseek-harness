/** Whole-session terminal readings over the same projections used by the Web client. */
import type { Balance, ModelChoice, Readings } from './port.ts'
import { formatCacheHitPercent, formatTokensPerSecond } from '@deepseek-ai/dsh-token-meter/client'

/** Balance query state; failure never retains an apparently current wallet. */
export type BalanceReading = Balance | 'loading'

/**
 * Render recharge and bonus wallets without combining currencies or losing decimal precision.
 * @param balance - latest account query outcome.
 * @returns display-safe wallet reading; callers strip terminal control sequences.
 */
export function balanceText(balance: BalanceReading): string {
  if (balance === 'loading') return 'Loading…'
  if (balance === null) return '未提供'
  if (balance.status === 'failed') return 'Query failed · /stats to retry'
  const wallets = [
    ...balance.wallets.map(wallet => `${wallet.currency} ${wallet.balance}`),
    ...balance.bonusWallets.map(wallet => `${wallet.currency} ${wallet.balance} bonus`),
  ]
  return wallets.length === 0 ? '未提供' : wallets.join(' + ')
}

/**
 * Format whole-log usage, excluding first-token latency from decode throughput.
 * @param values - authoritative Session projections, independent of the transcript window.
 * @param selection - next request's selection, or the deployment default for a blank Session.
 * @param balance - account wallet query outcome.
 * @returns compact status and a detailed statistics panel.
 */
export function sessionReadings(
  values: Readings, selection: ModelChoice | undefined, balance: BalanceReading,
): { compact: string; details: string } {
  const stats = values.stats
  const usage = values.usage
  const input = usage === undefined ? undefined : usage.uncachedInput + usage.cacheRead + usage.cacheWrite
  const hit = usage === undefined || input === undefined ? null : formatCacheHitPercent(usage.cacheRead, input)
  const speed = stats === undefined || stats.decodeMs <= 0 ? null : formatTokensPerSecond(stats.decodeTokens * 1000 / stats.decodeMs)
  const model = selection === undefined ? '未提供' : `${selection.provider}/${selection.model}`
  const effort = selection?.reasoningEffort ?? '未提供'
  const cache = hit === null ? '未提供' : `${hit}%`
  const throughput = speed === null ? '未提供' : `${speed} tok/s`
  const compact = `Model: ${model} · Reasoning: ${effort}\nCache: ${cache} · Output: ${throughput}\nBalance: ${balanceText(balance)}`
  const details = [compact, '', 'Whole session · provider-reported token usage',
    `Input: ${input ?? '未提供'} · Output: ${usage?.output ?? '未提供'}`,
    `Cache read: ${usage?.cacheRead ?? '未提供'} · Cache write: ${usage?.cacheWrite ?? '未提供'}`,
    `Uncached input: ${usage?.uncachedInput ?? '未提供'}`,
    `Turns: ${stats?.turns ?? '未提供'} · Steps: ${stats?.steps ?? '未提供'}`,
    `Average first token: ${stats !== undefined && stats.ttftSteps > 0 ? `${Math.round(stats.ttftMs / stats.ttftSteps)} ms` : '未提供'}`,
    'Balance is the signed-in DeepSeek account; configure providers and credentials in Web.',
  ].join('\n')
  return { compact, details }
}
