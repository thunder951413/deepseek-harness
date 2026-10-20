/**
 * Human-facing `/title` command over the session title service.
 * @module @deepseek-ai/dsh-command-title
 */

import type { Context } from '@deepseek-ai/cordis'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { SessionTitleInvalidError } from '@deepseek-ai/dsh-session-title'

export const name = 'command-title'
export const inject = ['commands', 'sessionTitle']

const USAGE = 'Usage: /title regenerates the title; /title <new title> sets it.'

/** Rename with the argument, or regenerate through the registered provider or the built-in fallback. */
async function executeTitle(ctx: Context, invocation: CommandInvocation): Promise<CommandResult> {
  const session = invocation.agent.session
  const requested = invocation.rawInput.trim()
  if (requested !== '') {
    try {
      return { kind: 'success', text: `Title: ${ctx.sessionTitle.rename(session, requested).title}` }
    } catch (error: unknown) {
      if (error instanceof SessionTitleInvalidError) return { kind: 'error', text: USAGE }
      throw error
    }
  }
  try {
    const title = await ctx.sessionTitle.refresh(session, invocation.signal)
    if (title === undefined) return { kind: 'success', text: 'No message to title yet.' }
    return { kind: 'success', text: `Title: ${title.title}` }
  } catch (error: unknown) {
    if (invocation.signal.aborted) return { kind: 'error', text: 'Title generation cancelled.' }
    // A provider failure leaves the accepted title in place; the user sees why and may retry.
    return { kind: 'error', text: `Title generation failed; the current title is kept: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * Register `/title` for every composed human-command adapter.
 * @param ctx - context carrying the command registry and the session title service.
 */
export function apply(ctx: Context): void {
  const active = new Set<Promise<CommandResult>>()
  const handler = (invocation: CommandInvocation): Promise<CommandResult> => {
    const operation = executeTitle(ctx, invocation)
    active.add(operation)
    const retire = (): void => { active.delete(operation) }
    // Both branches retire without rethrowing, so the observer promise cannot mirror a handler rejection.
    void operation.then(retire, retire)
    return operation
  }

  ctx.effect(function* () {
    // Yielded first so it runs last: LIFO teardown unregisters /title before started invocations settle.
    yield async () => { await Promise.allSettled(active) }
    yield ctx.commands.register({
      definitionId: CommandDefinitionId('@deepseek-ai/dsh-command-title'),
      name: 'title',
      description: 'Regenerate the conversation title, or set it',
      handler,
    })
  }, 'command-title lifecycle')
}
