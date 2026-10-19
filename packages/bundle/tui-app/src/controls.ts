/** Model selection and live account/session readings owned by one terminal lifetime. */
import { Unsupported, type HarnessPort, type ModelCatalogView, type ModelChoice, type Readings, type SessionId } from './port.ts'
import { sessionReadings, type BalanceReading } from './readings.ts'
import type { TerminalUi } from './ui.ts'

/** Services, input, and projections are shared with the Web application. */
export class TerminalControls {
  private selected: SessionId | undefined
  private values: Readings = {}
  private catalog: ModelCatalogView | undefined
  private balance: BalanceReading = null
  private balanceRequest: Promise<void> | undefined
  private projectionGeneration = 0
  private projectionError: string | undefined

  /**
   * @param ctx - shared Web services.
   * @param ui - terminal owned by the application.
   * @param signal - application cancellation.
   * @param version - terminal package version reported with balance queries.
   */
  constructor(private readonly ctx: Pick<HarnessPort,
    'readings' | 'watchReadings' | 'modelCatalog' | 'selectModel' | 'balance' | 'watchAccount'>, private readonly ui: Pick<TerminalUi, 'metrics' | 'choose' | 'accepted'>, private readonly signal: AbortSignal, private readonly version: string) {
    this.render()
  }

  private current(): ModelChoice | undefined {
    if (this.projectionError !== undefined) return undefined
    const selection = this.values.next ?? this.catalog?.default
    if (selection === undefined || selection.reasoningEffort !== undefined) return selection
    const model = this.catalog?.groups.find(group => group.id === selection.provider)?.models.find(model => model.id === selection.model)
    return model?.defaultEffort === undefined ? selection : { ...selection, reasoningEffort: model.defaultEffort }
  }

  private cancelled(): boolean { return this.signal.aborted }

  private render(): void {
    if (this.signal.aborted) return
    const reading = sessionReadings(this.values, this.current(), this.balance)
    this.ui.metrics(this.projectionError === undefined ? reading.compact : `${reading.compact}\n${this.projectionError}`)
  }

  /**
   * Change the displayed Session and discard the previous Session's readings immediately.
   * @param sessionId - selected conversation.
   * @returns after loading its whole-log projections.
   */
  async select(sessionId: SessionId): Promise<void> {
    this.selected = sessionId
    this.values = {}
    this.projectionError = undefined
    this.render()
    await this.refreshProjections()
  }

  private async refreshProjections(): Promise<void> {
    const sessionId = this.selected
    if (sessionId === undefined || this.cancelled()) return
    const generation = ++this.projectionGeneration
    try {
      const result = await this.ctx.readings(sessionId, this.signal)
      if (generation !== this.projectionGeneration || sessionId !== this.selected || this.cancelled()) return
      this.values = result?.kind === 'values' ? result.readings : {}
      this.projectionError = result?.kind === 'migration-required' ? 'Statistics need Session migration; send a message to resume.' : undefined
    } catch (error) {
      // A failed read invalidates displayed totals; /stats performs a fresh read.
      if (generation !== this.projectionGeneration || sessionId !== this.selected || this.cancelled()) return
      this.values = {}
      this.projectionError = error instanceof Unsupported ? undefined : 'Statistics unavailable · /stats to retry'
    }
    this.render()
  }

  /**
   * Observe host-side projection replacements, including selections made in Web.
   * @returns after application cancellation or a stream failure.
   */
  async watchSessions(): Promise<void> {
    try {
      for await (const change of this.ctx.watchReadings(this.signal)) {
        if (change.sessionId === undefined || (change.sessionId === this.selected && change.key !== undefined
          && ['modelSelection', 'sessionStats', 'tokenUsage'].includes(change.key))) await this.refreshProjections()
      }
    } catch (error) {
      if (!this.signal.aborted) {
        this.values = {}
        this.projectionError = 'Live statistics disconnected · restart tui to reconnect'
        this.render()
        throw error
      }
    }
  }

  /**
   * Refresh the balance when the shared account changes, including browser sign-in/out.
   * @returns after application cancellation or a stream failure.
   */
  async watchAccount(): Promise<void> {
    try {
      for await (const _state of this.ctx.watchAccount(this.signal)) await this.refreshBalance()
    } finally {
      await this.balanceRequest
    }
  }

  /**
   * Refresh the account wallet with concurrent reads sharing one request.
   * @returns after the balance or a visible failure replaces the previous value.
   */
  refreshBalance(): Promise<void> {
    if (this.balanceRequest !== undefined) return this.balanceRequest
    if (this.signal.aborted) return Promise.resolve()
    this.balance = 'loading'
    this.render()
    const request = (async () => {
      try {
        this.balance = await this.ctx.balance({ version: this.version,
          locale: Intl.DateTimeFormat().resolvedOptions().locale,
          timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60 })
      } catch (error) {
        // Wallet transport failures do not invalidate model or Session state.
        this.balance = error instanceof Unsupported ? null : { status: 'failed' }
      }
      this.render()
    })()
    this.balanceRequest = request
    return request.finally(() => { this.balanceRequest = undefined })
  }

  /**
   * Load the shared model directory, preserving provider-local failures for the picker.
   * @returns after a fresh catalog is available.
   */
  async loadModels(): Promise<void> {
    try {
      this.catalog = await this.ctx.modelCatalog()
    } catch (error) {
      if (!(error instanceof Unsupported)) throw error
      this.catalog = undefined
    }
    this.render()
  }

  /**
   * Execute a recognized terminal command; no command text becomes model input.
   * @param text - editor contents, including the leading slash.
   * @returns whether this was a terminal command.
   */
  async command(text: string): Promise<boolean> {
    const typed = text.trim()
    const command = typed === '/cost' ? '/stats' : typed
    if (!['/model', '/reasoning', '/stats'].includes(command)) return false
    if (this.selected === undefined) throw new Error('Choose a conversation first')
    this.ui.accepted()
    if (command === '/stats') {
      await Promise.all([this.refreshProjections(), this.refreshBalance()])
      const reading = sessionReadings(this.values, this.current(), this.balance)
      await this.ui.choose(`${reading.details}\n${this.projectionError ?? ''}`, ['Close'], this.signal)
      return true
    }
    await this.loadModels()
    await this.refreshProjections()
    const catalog = this.catalog
    if (catalog === undefined) throw new Error('This Harness does not provide a model directory; choose models in Web')
    let selection = this.current()
    if (command === '/model') {
      const models = catalog.groups.flatMap(group => group.models.map(model => ({ group, model })))
      const failures = catalog.failures.map(failure => `${failure.name}: ${failure.message}`).join('\n')
      if (models.length === 0) throw new Error(`No configured models; configure a provider in Web. ${failures}`)
      const index = await this.ui.choose(`Select model · applies to the next model request\n${failures}`,
        models.map(({ group, model }) => `${group.name} / ${model.name} (${model.id})`), this.signal)
      const picked = index === undefined ? undefined : models[index]
      if (picked === undefined) return true
      selection = { provider: picked.group.id, model: picked.model.id,
        ...picked.model.defaultEffort === undefined ? {} : { reasoningEffort: picked.model.defaultEffort } }
    } else {
      if (selection === undefined) throw new Error('Select a model first with /model')
      const current = selection
      const model = catalog.groups.find(group => group.id === current.provider)?.models.find(model => model.id === current.model)
      if (model === undefined) throw new Error('Selected model is unavailable; choose another with /model')
      const efforts = model.efforts
      if (efforts.length === 0) {
        await this.ui.choose('This model does not offer selectable reasoning levels.', ['Close'], this.signal)
        return true
      }
      const index = await this.ui.choose(`Reasoning · ${model.name} · current: ${current.reasoningEffort ?? model.defaultEffort ?? '未提供'}`,
        efforts.map(effort => `${effort.name}${effort.description === undefined ? '' : ` — ${effort.description}`}`), this.signal)
      const effort = index === undefined ? undefined : efforts[index]
      if (effort === undefined) return true
      selection = { provider: current.provider, model: current.model, reasoningEffort: effort.id }
    }
    this.signal.throwIfAborted()
    await this.ctx.selectModel(this.selected, selection)
    await this.refreshProjections()
    return true
  }
}
