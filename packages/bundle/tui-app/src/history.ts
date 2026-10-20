/** Scope of the conversation list shown by `/resume`. */
import { realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { SessionSummary } from './port.ts'

/**
 * Resolve a directory the way Workspaces name it.
 * @param path - directory as typed or recorded.
 * @returns its physical path, or the lexical absolute path when it no longer exists.
 */
export async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch (_error) {
    // A directory that no longer exists keeps its lexical form, so it still matches itself.
    return resolve(path)
  }
}

/**
 * Keep the conversations that belong to one directory.
 * @param directory - directory the terminal was started in.
 * @param sessions - persisted conversations from every directory.
 * @returns conversations whose directory is the same physical directory, in the original order.
 */
export async function sessionsIn(directory: string, sessions: readonly SessionSummary[]): Promise<SessionSummary[]> {
  const wanted = await canonical(directory)
  const kept = await Promise.all(sessions.map(async session =>
    session.cwd !== undefined && await canonical(session.cwd) === wanted))
  return sessions.filter((_session, index) => kept[index])
}
