import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SessionTitleService, { SessionTitleProviderId, type SessionTitleProviderRequest } from '@deepseek-ai/dsh-session-title'
import * as commandTitle from '@deepseek-ai/dsh-command-title'

/** Build a live idle agent whose store-created session receives the command lifecycle. */
function stubAgent(session: Session): { agent: Agent; session: Session } {
  const inbox = createInboxStub()
  const agent: Agent = {
    id: session.id,
    options: {},
    session,
    inbox,
    ctx: new Context(),
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject(input) { this.inbox.append('next-step', input) },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle() { return Promise.resolve() },
  }
  return { agent, session }
}

/** Mount the real command registry and title service, then this plugin. */
async function harness() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SessionTitleService, { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 40 })
  const plugin = await ctx.plugin(commandTitle)
  const { agent, session } = stubAgent(ctx.sessions.create(SessionId(`command-title-${Math.random()}`)))
  await ctx.agents.register(agent)
  const run = async (line: string, signal = new AbortController().signal) => {
    const execution = await ctx.commands.execute(agent, line, [], signal)
    if (execution === undefined) throw new Error('title command was not registered')
    return execution.result
  }
  const prompt = (text: string) => session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  return { ctx, session, plugin, run, prompt, agent }
}

it('reports that nothing can be titled before the first message', async () => {
  const { run } = await harness()
  expect(await run('/title')).toEqual({ kind: 'success', text: 'No message to title yet.' })
})

it('derives the fallback title without a provider and replaces a title the user set', async () => {
  const { ctx, session, run, prompt } = await harness()
  session.append('turn/start', { turn: 1 })
  prompt('Explain how sessions are titled in detail')
  expect(await run('/title   Hand picked  ')).toEqual({ kind: 'success', text: 'Title: Hand picked' })
  expect(ctx.sessionTitle.get(session)?.source.kind).toBe('user')
  expect(await run('/title')).toEqual({ kind: 'success', text: 'Title: Explain how sessions are titled' })
  expect(ctx.sessionTitle.get(session)?.source.kind).toBe('fallback')
})

it('regenerates through the registered provider and keeps the title when it fails', async () => {
  const { ctx, session, run, prompt } = await harness()
  const requests: SessionTitleProviderRequest[] = []
  const failures: Error[] = []
  ctx.sessionTitle.register({
    id: SessionTitleProviderId('command-title-test'),
    automatic: 'first-prompt',
    async generate(request) {
      requests.push(request)
      const [failure] = failures
      if (failure !== undefined) throw failure
      return { title: 'Generated title', messageSeqs: request.messages.map(message => message.seq) }
    },
  })
  session.append('turn/start', { turn: 1 })
  prompt('First question')
  expect(await run('/title')).toEqual({ kind: 'success', text: 'Title: Generated title' })
  expect(requests).toHaveLength(1)
  failures.push(new Error('model unavailable'))
  expect(await run('/title')).toEqual({ kind: 'error', text: 'Title generation failed; the current title is kept: model unavailable' })
  expect(ctx.sessionTitle.get(session)?.title).toBe('Generated title')
})

it('stops a regeneration the caller cancels and keeps the current title', async () => {
  const { ctx, session, run, prompt } = await harness()
  ctx.sessionTitle.register({
    id: SessionTitleProviderId('command-title-slow'),
    automatic: 'first-prompt',
    generate: request => new Promise((_resolve, reject) => {
      request.signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
    }),
  })
  session.append('turn/start', { turn: 1 })
  prompt('Question')
  const controller = new AbortController()
  const reason = new Error('operator cancelled')
  const pending = run('/title', controller.signal)
  controller.abort(reason)
  // The executor settles a cancelled command with the caller's reason.
  await expect(pending).rejects.toBe(reason)
  expect(ctx.sessionTitle.get(session)?.source.kind).toBe('fallback')
})

it('rejects a title without visible characters', async () => {
  const { run } = await harness()
  expect(await run('/title \u0007')).toEqual({ kind: 'error', text: 'Usage: /title regenerates the title; /title <new title> sets it.' })
})

it('unregisters the command when the plugin is disposed', async () => {
  const { ctx, plugin, agent } = await harness()
  expect(ctx.commands.list(agent).some(command => command.name === 'title')).toBe(true)
  await plugin.dispose()
  expect(ctx.commands.list(agent).some(command => command.name === 'title')).toBe(false)
})

it('reports a provider rejection that is not an Error, and surfaces unexpected rename failures', async () => {
  const { ctx, session, run, prompt } = await harness()
  ctx.sessionTitle.register({
    id: SessionTitleProviderId('command-title-plain'),
    automatic: 'first-prompt',
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- exercise a provider that rejects with a plain value.
    generate: () => Promise.reject('quota exceeded'),
  })
  session.append('turn/start', { turn: 1 })
  prompt('Question')
  expect(await run('/title')).toEqual({ kind: 'error', text: 'Title generation failed; the current title is kept: quota exceeded' })

  // A session outside the store cannot be renamed; that is a fault, not a usage error.
  const { agent: detached } = stubAgent(Session.create(SessionId('command-title-detached')))
  await expect(ctx.commands.execute(detached, '/title Name', [], new AbortController().signal)).rejects.toThrow('is not live')
})
