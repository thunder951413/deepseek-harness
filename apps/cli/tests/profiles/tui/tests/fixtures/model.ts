/** Deterministic external-model replacement; tools and Session services stay real. */
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, ReasoningEffortId, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

class TerminalModel extends LlmAdapter {
  override providerInfo(provider: string) { return { id: provider, name: 'Terminal fixture' } }
  override listModels(provider: string) {
    console.info('Terminal fixture model listing')
    return Promise.resolve(['fixture', 'alternate'].map(id => ({ provider, id, name: id, inputModalities: ['text'] as const })))
  }

  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] as const,
      context: { contextWindow: 100000 },
      reasoning: { efforts: [{ id: ReasoningEffortId('low'), name: 'Low' }, { id: ReasoningEffortId('high'), name: 'High' }],
        defaultEffort: ReasoningEffortId('low') } })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const lastUser = options.messages.findLastIndex(message => message.role === 'user' && message.source?.kind === 'user')
    const messages = options.messages.slice(lastUser)
    const prompt = messages[0]?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('') ?? ''
    const hasResult = messages.some(message => message.role === 'tool')
    if (!hasResult && ['approve', 'reject', 'question', 'free-question'].includes(prompt)) {
      const question = prompt === 'question' || prompt === 'free-question'
      const name = question ? 'ask_user_question' : 'bash'
      const args = question
        ? { questions: [prompt === 'question'
          ? { id: 'color', question: 'Choose a color', options: [{ label: 'Blue' }, { label: 'Green' }] }
          : { id: 'text', question: 'Describe the change' }] }
        : { description: 'Write the terminal acceptance test file', command: 'printf tui-proof > tui-proof.txt',
          sandbox_permissions: 'danger-full-access', justification: 'Terminal approval acceptance test' }
      const id = ToolCallId(`tui-${String(lastUser)}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: JSON.stringify(args) }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: JSON.stringify(args) } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const text = prompt === 'markdown' ? '# Terminal heading\n\n**Bold result**\n\n```ts\nconst answer = 42\n```' : prompt === 'selection' ? `Selected ${options.model} / ${options.reasoningEffort ?? 'none'}` : prompt === 'wait' ? 'Waiting for cancellation' : `Reply to ${prompt}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    if (prompt === 'wait') {
      const signal = options.signal
      if (signal === undefined) throw new Error('Missing cancellation signal')
      if (!signal.aborted) await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
      signal.throwIfAborted()
    }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 20, cacheReadTokens: 60, outputTokens: 10 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Stable fixture plugin identity. */
export const name = 'terminal-fixture-model'
/** Real adapter registry required by the replacement. */
export const inject = ['llm']
/** @param ctx - fixture composition context. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['terminal-fixture'], new TerminalModel())
}
