/** Conversation following: turns port frames into display updates. */
import type { HarnessPort, ConversationId } from './port.ts'
import type { TerminalView } from './transcript.ts'
import { TerminalTranscript } from './wire-transcript.ts'

/** One display update from a followed conversation. */
export interface ConversationUpdate {
  readonly view: TerminalView
  /** Present when the opening snapshot reported the conversation directory. */
  readonly directory?: string
  /** Whether this update settled a turn. */
  readonly turnEnded: boolean
}

/**
 * Follow a conversation and project it to bounded display blocks.
 * @param port - connected Harness.
 * @param sessionId - conversation to follow.
 * @param historyMessages - requested recent history bound.
 * @param maxCharacters - retained display bound.
 * @param fallbackDirectory - directory used when the snapshot reports none.
 * @param signal - selection lifetime.
 * @returns display updates until cancellation or the follow stream ends.
 */
export async function* observe(port: Pick<HarnessPort, 'follow'>, sessionId: ConversationId, historyMessages: number, maxCharacters: number,
  fallbackDirectory: string, signal: AbortSignal): AsyncGenerator<ConversationUpdate> {
  const transcript = new TerminalTranscript(maxCharacters)
  let hasMore = false
  for await (const frame of port.follow(sessionId, historyMessages, signal)) {
    if (signal.aborted) return
    let directory: string | undefined
    let turnEnded = false
    if (frame.kind === 'snapshot') {
      transcript.reset()
      hasMore = frame.hasMore === true
      directory = frame.cwd ?? fallbackDirectory
      for (const event of frame.events) transcript.accept(event)
      if (frame.active !== undefined) transcript.restore(frame.active)
    } else if (frame.kind === 'event') {
      transcript.accept(frame.event)
      turnEnded = frame.event.type === 'turn/end'
    } else transcript.stream(frame.frame)
    yield { view: { ...transcript.view(), ...hasMore ? { truncated: true } : {} },
      ...directory === undefined ? {} : { directory }, turnEnded }
  }
}
