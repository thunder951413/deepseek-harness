/** Model selection and live account/session readings owned by one terminal lifetime. */
import { TerminalLocale } from './locale.ts'
import { Unsupported, type HarnessPort, type ModeChoice, type ModelCatalogView, type ModelChoice, type Readings, type ConversationId } from './port.ts'
import { sessionReadings, type BalanceReading } from './readings.ts'
import type { TerminalUi } from './ui.ts'

/** Services, input, and projections are shared with the Web application. */
export class TerminalControls {
  private selected: ConversationId | undefined
  private values: Readings = {}
  private catalog: ModelCatalogView | undefined
  private modes: readonly ModeChoice[] = []
  private balance: BalanceReading = null
  private balanceRequest: Promise<void> | undefined
  private projectionGeneration = 0
  private queueGeneration = 0
  private projectionError: string | undefined

  /**
   * @param ctx - shared Web services.
   * @param ui - terminal owned by the application.
   * @param signal - application cancellation.
   * @param version - terminal package version reported with balance queries.
   * @param locale - terminal interface language.
   */
  constructor(private readonly ctx: Pick<HarnessPort,
    'queue' | 'readings' | 'watchReadings' | 'modelCatalog' | 'selectModel' | 'modes' | 'balance' | 'watchAccount'>, private readonly ui: Pick<TerminalUi, 'queueCount' | 'metrics' | 'conversationTitle' | 'choose' | 'view' | 'accepted'>, private readonly signal: AbortSignal, private readonly version: string, private readonly locale = new TerminalLocale()) {
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

  /**
   * Read the selected conversation's permission selection.
   * @returns its permission preset, `auto`, or `custom`; undefined when the Harness has no permission presets.
   */
  permission(): string | undefined { return this.values.permission }

  /**
   * Resolve the selected conversation's work mode against the loaded roster.
   * @returns the named mode, the default mode when the conversation names none, or undefined without a roster.
   */
  currentMode(): ModeChoice | undefined {
    const id = this.values.mode
    return this.modes.find(mode => id === undefined ? mode.isDefault : mode.id === id)
  }

  /**
   * Load the work-mode roster; a Harness without modes leaves it empty.
   * @returns the roster, which also names the mode shown in the status.
   */
  async loadModes(): Promise<readonly ModeChoice[]> {
    try {
      this.modes = await this.ctx.modes(this.signal)
    } catch (error) {
      if (!(error instanceof Unsupported)) throw error
      this.modes = []
    }
    this.render()
    return this.modes
  }

  private render(): void {
    if (this.signal.aborted) return
    const reading = sessionReadings(this.values, this.current(), this.balance, this.locale, this.currentMode()?.name)
    this.ui.metrics(this.projectionError === undefined ? reading.compact : `${reading.compact}\n${this.projectionError}`, reading.model)
    this.ui.conversationTitle(this.values.title)
  }

  /**
   * Change the displayed Session and discard the previous Session's readings immediately.
   * @param sessionId - selected conversation.
   * @returns after loading its whole-log projections.
   */
  async select(sessionId: ConversationId): Promise<void> {
    this.selected = sessionId
    this.values = {}
    this.projectionError = undefined
    this.render()
    this.ui.queueCount(undefined)
    await Promise.all([this.refreshProjections(), this.refreshQueue()])
  }

  /**
   * Give a new conversation the configured reasoning effort when its next model offers it.
   * An explicit selection already recorded for the conversation is never replaced.
   * @param sessionId - conversation just created and selected.
   * @param effort - effort identifier; empty keeps the model's own default.
   * @returns after the selection is saved, or immediately when nothing applies.
   */
  async useDefaultEffort(sessionId: ConversationId, effort: string): Promise<void> {
    if (effort === '' || sessionId !== this.selected) return
    if (this.catalog === undefined) await this.loadModels()
    const selection = this.current()
    if (selection === undefined || this.values.next?.reasoningEffort !== undefined || selection.reasoningEffort === effort) return
    const model = this.catalog?.groups.find(group => group.id === selection.provider)?.models.find(model => model.id === selection.model)
    if (model?.efforts.some(candidate => candidate.id === effort) !== true) return
    this.signal.throwIfAborted()
    await this.ctx.selectModel(sessionId, { provider: selection.provider, model: selection.model, reasoningEffort: effort })
    await this.refreshProjections()
  }

  private async refreshQueue(): Promise<void> {
    const id = this.selected
    if (id === undefined) return
    const generation = ++this.queueGeneration
    try {
      const messages = await this.ctx.queue(id, this.signal)
      if (generation === this.queueGeneration && id === this.selected && !this.cancelled()) this.ui.queueCount(messages.length)
    } catch {
      // Queue controls report actionable failures when opened; a count that cannot be refreshed is hidden.
      if (!this.cancelled() && id === this.selected && generation === this.queueGeneration) this.ui.queueCount(undefined)
    }
  }

  private async refreshProjections(): Promise<void> {
    const sessionId = this.selected
    if (sessionId === undefined || this.cancelled()) return
    const generation = ++this.projectionGeneration
    try {
      const result = await this.ctx.readings(sessionId, this.signal)
      if (generation !== this.projectionGeneration || sessionId !== this.selected || this.cancelled()) return
      this.values = result?.kind === 'values' ? result.readings : {}
      this.projectionError = result?.kind === 'migration-required' ? this.locale.text('Statistics need Session migration; send a message to resume.') : undefined
    } catch (error) {
      // A failed read invalidates displayed totals; /stats performs a fresh read.
      if (generation !== this.projectionGeneration || sessionId !== this.selected || this.cancelled()) return
      this.values = {}
      this.projectionError = error instanceof Unsupported ? undefined : this.locale.text('Statistics unavailable · /stats to retry')
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
        if (change.sessionId === undefined || (change.sessionId === this.selected && change.key === 'inbox')) void this.refreshQueue()
        if (change.sessionId === undefined || (change.sessionId === this.selected && change.key !== undefined
          && ['title', 'agentPreset', 'permissions', 'modelSelection', 'sessionStats', 'tokenUsage'].includes(change.key))) {
          await this.refreshProjections()
        }
      }
    } catch (error) {
      if (!this.signal.aborted) {
        this.values = {}
        this.projectionError = this.locale.text('Live statistics disconnected · /reconnect to retry')
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
      const reading = sessionReadings(this.values, this.current(), this.balance, this.locale, this.currentMode()?.name)
      await this.ui.view(this.locale.text('Statistics'), `${reading.details}\n${this.projectionError ?? ''}`, this.signal)
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
      const index = await this.ui.choose(`${this.locale.text('Select model · applies to the next model request')}\n${failures}`,
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
        await this.ui.choose(this.locale.text('This model does not offer selectable reasoning levels.'), [this.locale.text('Close')], this.signal)
        return true
      }
      const index = await this.ui.choose(this.locale.text('Reasoning · {model} · current: {effort}', { model: model.name, effort: current.reasoningEffort ?? model.defaultEffort ?? this.locale.text('Unavailable') }),
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
