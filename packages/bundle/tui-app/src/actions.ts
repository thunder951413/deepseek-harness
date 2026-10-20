/** Local conversation commands over optional Harness services. */
import { open, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { HarnessPort, ConversationId } from './port.ts'
import type { TerminalUi } from './ui.ts'
import type { TerminalView } from './transcript.ts'

/** Write an archive exclusively; a failed download removes only the file created here.
 * @param port - authenticated archive source.
 * @param id - conversation to export.
 * @param path - destination, which must not already exist.
 * @param signal - cancellation.
 * @returns after all bytes and the file handle have been flushed and closed. */
export async function exportArchive(port: Pick<HarnessPort, 'exportLog'>, id: ConversationId, path: string, signal: AbortSignal): Promise<void> {
  const file = await open(path, 'wx', 0o600)
  try {
    for await (const chunk of port.exportLog(id, signal)) { signal.throwIfAborted(); await file.writeFile(chunk) }
    signal.throwIfAborted()
    await file.sync()
    await file.close()
  } catch (error) {
    await Promise.allSettled([file.close()])
    await unlink(path)
    throw error
  }
}

/** Browse retained tools, preserving selection when closing an argument/output reader.
 * @param ui - terminal reader and picker.
 * @param transcript - current retained transcript.
 * @param signal - selection lifetime.
 * @returns after the browser is dismissed. */
export async function browseTools(ui: Pick<TerminalUi, 'locale' | 'choose' | 'view'>, transcript: TerminalView, signal: AbortSignal): Promise<void> {
  const t = ui.locale.text.bind(ui.locale)
  const all = transcript.entries.flatMap(entry => entry.group?.calls ?? []).toReversed()
  let failed = false
  let selected = 1
  while (!signal.aborted) {
    const calls = failed ? all.filter(call => call.state === 'failed') : all
    const index = await ui.choose(t('Tool activity'), [t(failed ? 'Show all calls' : 'Show failed calls only'),
      ...calls.map(call => `${call.state === 'failed' ? '✗' : call.state === 'running' ? '…' : '✓'} ${call.title}`)], signal, Math.min(selected, calls.length))
    if (index === undefined) return
    if (index === 0) { failed = !failed; selected = 1; continue }
    selected = index
    const call = calls[index - 1]
    if (call === undefined) continue
    const boundary = Math.min(call.argumentLength ?? 0, call.details.length)
    const body = [`${t('Arguments')}\n${call.details.slice(0, boundary)}`, `${t('Output')}\n${call.details.slice(boundary).trim() || t('No text output')}`,
      ...call.truncated === true ? [t('Output truncated · /export downloads the complete log')] : []].join('\n\n')
    await ui.view(call.title, body, signal)
  }
}

/** Manage human text messages that the Host has not yet claimed.
 * @param ui - terminal picker and editor.
 * @param port - authoritative queue service.
 * @param id - selected conversation.
 * @param signal - selection lifetime.
 * @returns after dismissal or when no editable messages remain. */
export async function manageQueue(ui: Pick<TerminalUi, 'locale' | 'choose' | 'ask' | 'status'>, port: Pick<HarnessPort, 'queue' | 'updateQueue'>,
  id: ConversationId, signal: AbortSignal): Promise<void> {
  const t = ui.locale.text.bind(ui.locale)
  while (!signal.aborted) {
    const messages = await port.queue(id, signal)
    if (messages.length === 0) { ui.status(t('No pending messages')); return }
    const index = await ui.choose(t('Pending messages'), messages.map(item => `${item.target === 'next-step' ? '↳' : '⌛'} ${item.text}`), signal)
    const item = index === undefined ? undefined : messages[index]
    if (item === undefined) return
    const action = await ui.choose(t('Pending messages'), [t('Edit'), t('Remove'), t('Steer now')], signal)
    if (action === 0) {
      const text = await ui.ask(t('Edit pending message'), signal, item.text)
      if (text !== undefined && text.trim() !== '') await port.updateQueue(id, item.id, { kind: 'edit', text })
    } else if (action === 1 || action === 2) await port.updateQueue(id, item.id, { kind: action === 1 ? 'remove' : 'steer' })
  }
}

/** Collect the destination for a complete Session log.
 * @param ui - terminal input.
 * @param id - selected conversation.
 * @param signal - cancellation.
 * @returns an absolute path (`~/` expands to the home directory), or undefined after dismissal. */
export async function askExportPath(ui: Pick<TerminalUi, 'ask' | 'locale'>, id: ConversationId, signal: AbortSignal): Promise<string | undefined> {
  const t = ui.locale.text.bind(ui.locale)
  const destination = (await ui.ask(t('Export destination (.zip); existing files are not overwritten'), signal,
    resolve(`dsh-${id.replace(/[^a-zA-Z0-9_-]/gu, '_')}.zip`)))?.trim()
  if (destination === undefined || destination === '') return undefined
  return resolve(destination.startsWith('~/') ? join(homedir(), destination.slice(2)) : destination)
}
