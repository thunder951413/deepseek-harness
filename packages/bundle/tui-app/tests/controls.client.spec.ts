/** Terminal selection races, query failure containment, and command ownership. */
import { expect, it, vi } from 'vitest'
import { TerminalControls } from '../src/controls.ts'
import { SessionId, Unsupported, type Balance, type ModelCatalogView, type ReadingsChange, type ReadingsResult } from '../src/port.ts'

const catalog: ModelCatalogView = {
  default: { provider: 'test', model: 'model' }, failures: [],
  groups: [{ id: 'test', name: 'Test', models: [
    { id: 'model', name: 'Model', efforts: [] },
    { id: 'thinker', name: 'Thinker', defaultEffort: 'low', efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High', description: 'slow' }] },
  ] }],
}

function harness() {
  const abort = new AbortController()
  const changes: ReadingsChange[] = []
  const services: ConstructorParameters<typeof TerminalControls>[0] = {
    readings: vi.fn(async (): Promise<ReadingsResult | undefined> => ({ kind: 'values', readings: {} })),
    watchReadings: vi.fn(async function* () { yield* changes }),
    modelCatalog: vi.fn(async () => catalog),
    selectModel: vi.fn(async () => {}),
    balance: vi.fn(async (): Promise<Balance> => null),
    async *watchAccount() { yield },
  }
  const ui = { metrics: vi.fn(), accepted: vi.fn(),
    choose: vi.fn(async (_title: string, _choices: readonly string[], _signal: AbortSignal): Promise<number | undefined> => 0) }
  const controls = new TerminalControls(services, ui, abort.signal, '1.2.3')
  return { controls, services, ui, abort, changes }
}

it('reports the terminal version with balance queries', async () => {
  const { controls, services } = harness()
  await controls.refreshBalance()
  expect(services.balance).toHaveBeenCalledWith(expect.objectContaining({ version: '1.2.3' }))
})

it('ignores an old Session read that finishes after switching conversations', async () => {
  const { controls, services, ui } = harness()
  const old = Promise.withResolvers<ReadingsResult>()
  vi.mocked(services.readings).mockImplementationOnce(() => old.promise)
    .mockResolvedValueOnce({ kind: 'values', readings: { next: { provider: 'test', model: 'new' } } })
  const first = controls.select(SessionId('old'))
  await controls.select(SessionId('new'))
  old.resolve({ kind: 'values', readings: { next: { provider: 'test', model: 'old' } } })
  await first
  expect(ui.metrics.mock.lastCall?.[0]).toContain('test/new')
})

it('coalesces wallet queries and replaces prior balances when a refresh fails', async () => {
  const { controls, services, ui } = harness()
  const pending = Promise.withResolvers<Balance>()
  vi.mocked(services.balance).mockImplementationOnce(() => pending.promise)
  const first = controls.refreshBalance()
  const second = controls.refreshBalance()
  expect(services.balance).toHaveBeenCalledTimes(1)
  pending.resolve({ status: 'ready', wallets: [{ currency: 'CNY', balance: '15.20' }], bonusWallets: [] })
  await Promise.all([first, second])
  expect(ui.metrics.mock.lastCall?.[0]).toContain('CNY 15.20')
  vi.mocked(services.balance).mockRejectedValueOnce(new Error('offline'))
  await controls.refreshBalance()
  expect(ui.metrics.mock.lastCall?.[0]).toContain('Query failed')
  expect(ui.metrics.mock.lastCall?.[0]).not.toContain('15.20')
})

it('shows missing optional features as unreported instead of failing', async () => {
  const { controls, services, ui } = harness()
  vi.mocked(services.balance).mockRejectedValueOnce(new Unsupported('balance'))
  await controls.refreshBalance()
  expect(ui.metrics.mock.lastCall?.[0]).toContain('Balance: 未提供')
  vi.mocked(services.readings).mockRejectedValueOnce(new Unsupported('readings'))
  await controls.select(SessionId('one'))
  expect(ui.metrics.mock.lastCall?.[0]).not.toContain('unavailable')
  vi.mocked(services.modelCatalog).mockRejectedValue(new Unsupported('models'))
  await controls.loadModels()
  await expect(controls.command('/model')).rejects.toThrow('does not provide a model directory')
})

it('rethrows a real model-directory failure', async () => {
  const { controls, services } = harness()
  vi.mocked(services.modelCatalog).mockRejectedValueOnce(new Error('offline'))
  await expect(controls.loadModels()).rejects.toThrow('offline')
})

it('leaves selection unchanged on dismissal and explains models without reasoning controls', async () => {
  const { controls, services, ui } = harness()
  await controls.select(SessionId('one'))
  ui.choose.mockResolvedValueOnce(undefined)
  expect(await controls.command('/model')).toBe(true)
  expect(services.selectModel).not.toHaveBeenCalled()
  expect(await controls.command('/reasoning')).toBe(true)
  expect(ui.choose.mock.lastCall?.[0]).toContain('does not offer selectable reasoning')
  expect(await controls.command('ordinary message')).toBe(false)
})

it('selects a model with its default effort and then changes only the effort', async () => {
  const { controls, services, ui } = harness()
  await controls.select(SessionId('one'))
  ui.choose.mockResolvedValueOnce(1)
  await controls.command('/model')
  expect(services.selectModel).toHaveBeenLastCalledWith(SessionId('one'), { provider: 'test', model: 'thinker', reasoningEffort: 'low' })
  vi.mocked(services.readings).mockResolvedValue({ kind: 'values', readings: { next: { provider: 'test', model: 'thinker' } } })
  ui.choose.mockResolvedValueOnce(1)
  await controls.command('/reasoning')
  expect(ui.choose.mock.calls.at(-1)?.[0]).toContain('current: low')
  expect(services.selectModel).toHaveBeenLastCalledWith(SessionId('one'), { provider: 'test', model: 'thinker', reasoningEffort: 'high' })
})

it('reports commands that need a conversation, a configured model, or a known model', async () => {
  const { controls, services } = harness()
  await expect(controls.command('/stats')).rejects.toThrow('Choose a conversation first')
  await controls.select(SessionId('one'))
  vi.mocked(services.modelCatalog).mockResolvedValue({ ...catalog, groups: [], failures: [{ name: 'p', message: 'down' }] })
  await expect(controls.command('/model')).rejects.toThrow('No configured models')
  vi.mocked(services.modelCatalog).mockResolvedValue({ failures: [], groups: [] })
  await expect(controls.command('/reasoning')).rejects.toThrow('Select a model first')
  vi.mocked(services.modelCatalog).mockResolvedValue({ default: { provider: 'test', model: 'ghost' }, failures: [], groups: [] })
  await expect(controls.command('/reasoning')).rejects.toThrow('Selected model is unavailable')
})

it('shows complete statistics for /stats', async () => {
  const { controls, services, ui } = harness()
  await controls.select(SessionId('one'))
  vi.mocked(services.readings).mockResolvedValue({ kind: 'values', readings: {
    usage: { uncachedInput: 1, cacheRead: 3, cacheWrite: 0, output: 5 } } })
  expect(await controls.command('/stats')).toBe(true)
  expect(ui.choose.mock.lastCall?.[0]).toContain('Input: 4 · Output: 5')
})

it('refreshes readings for relevant live changes only and reports a disconnected stream', async () => {
  const { controls, services, changes, ui } = harness()
  await controls.select(SessionId('one'))
  vi.mocked(services.readings).mockClear()
  changes.push({}, { sessionId: SessionId('other'), key: 'tokenUsage' }, { sessionId: SessionId('one'), key: 'title' },
    { sessionId: SessionId('one'), key: 'tokenUsage' })
  await controls.watchSessions()
  expect(services.readings).toHaveBeenCalledTimes(2)
  const broken = harness()
  vi.mocked(broken.services.watchReadings).mockImplementation(() => ({
    [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error('closed')) }),
  }))
  await expect(broken.controls.watchSessions()).rejects.toThrow('closed')
  expect(broken.ui.metrics.mock.lastCall?.[0]).toContain('Live statistics disconnected')
  expect(ui.metrics).toHaveBeenCalled()
})

it('refreshes the balance for account changes and flags sessions that need migration', async () => {
  const { controls, services, ui } = harness()
  await controls.watchAccount()
  expect(services.balance).toHaveBeenCalledTimes(1)
  vi.mocked(services.readings).mockResolvedValue({ kind: 'migration-required', readings: {} })
  await controls.select(SessionId('one'))
  expect(ui.metrics.mock.lastCall?.[0]).toContain('need Session migration')
})

it('removes stale statistics on a failed read and stops rendering after cancellation', async () => {
  const { controls, services, ui, abort } = harness()
  await controls.loadModels()
  vi.mocked(services.readings).mockRejectedValueOnce(new Error('unavailable'))
  await controls.select(SessionId('one'))
  expect(ui.metrics.mock.lastCall?.[0]).toContain('Statistics unavailable')
  expect(ui.metrics.mock.lastCall?.[0]).toContain('Model: 未提供')
  abort.abort()
  ui.metrics.mockClear()
  await controls.refreshBalance()
  expect(ui.metrics).not.toHaveBeenCalled()
})

it('does nothing after cancellation and ignores stale failures and a closing live stream', async () => {
  const { controls, services, ui, abort } = harness()
  const old = Promise.withResolvers<ReadingsResult>()
  vi.mocked(services.readings).mockImplementationOnce(() => old.promise)
  const first = controls.select(SessionId('old'))
  await controls.select(SessionId('new'))
  old.reject(new Error('late'))
  await first
  expect(ui.metrics.mock.lastCall?.[0]).not.toContain('unavailable')
  abort.abort()
  ui.metrics.mockClear()
  await controls.select(SessionId('after'))
  expect(ui.metrics).not.toHaveBeenCalled()
  vi.mocked(services.watchReadings).mockImplementation(() => ({
    [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error('closed')) }),
  }))
  await expect(controls.watchSessions()).resolves.toBeUndefined()
})

it('accepts /cost as /stats and picks models without reasoning defaults', async () => {
  const { controls, services, ui } = harness()
  await controls.select(SessionId('one'))
  expect(await controls.command('/cost')).toBe(true)
  expect(ui.choose.mock.lastCall?.[0]).toContain('Whole session')
  ui.choose.mockResolvedValueOnce(0)
  await controls.command('/model')
  expect(services.selectModel).toHaveBeenLastCalledWith(SessionId('one'), { provider: 'test', model: 'model' })
})

it('handles reasoning menus for models that list levels without a default and dismissals', async () => {
  const { controls, services, ui } = harness()
  vi.mocked(services.modelCatalog).mockResolvedValue({ default: { provider: 'test', model: 'plain' }, failures: [], groups: [
    { id: 'test', name: 'Test', models: [{ id: 'plain', name: 'Plain', efforts: [{ id: 'a', name: 'A' }] }] },
  ] })
  await controls.select(SessionId('one'))
  ui.choose.mockResolvedValueOnce(undefined)
  await controls.command('/reasoning')
  expect(ui.choose.mock.calls.at(-1)?.[0]).toContain('current: 未提供')
  expect(services.selectModel).not.toHaveBeenCalled()
  ui.choose.mockResolvedValueOnce(5)
  await controls.command('/reasoning')
  expect(services.selectModel).not.toHaveBeenCalled()
})
