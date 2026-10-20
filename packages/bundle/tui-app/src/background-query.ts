/** Ask the terminal for its background color without leaving bytes in the input stream. */
import { parseBackgroundReply, type Rgb } from './appearance.ts'

const ESC = '\u001b'
/** Device attributes reply, `ESC [ ? … c`, which every terminal sends and so marks the end of the wait. */
const ATTRIBUTES = new RegExp(`${ESC}\\[\\?[0-9;]*c`, 'u')

/** The input stream operations the query needs. */
export interface QueryInput {
  readonly isTTY?: boolean
  readonly isRaw?: boolean
  setRawMode(mode: boolean): unknown
  resume(): unknown
  pause(): unknown
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown
  off(event: 'data', listener: (chunk: Buffer | string) => void): unknown
}

/** The output stream operations the query needs. */
export interface QueryOutput {
  readonly isTTY?: boolean
  write(text: string): unknown
}

/**
 * Query the terminal background color (OSC 11), followed by a device attributes query. A terminal
 * that does not understand the first still answers the second, so it never costs the full timeout.
 * @param input - the terminal's input stream.
 * @param output - the terminal's output stream.
 * @param timeoutMs - longest wait for any answer.
 * @returns the background color, or undefined when streams are not a terminal or it did not answer.
 */
export async function queryBackground(input: QueryInput, output: QueryOutput, timeoutMs = 300): Promise<Rgb | undefined> {
  if (input.isTTY !== true || output.isTTY !== true) return undefined
  const wasRaw = input.isRaw === true
  input.setRawMode(true)
  input.resume()
  let received = ''
  const answer = new Promise<Rgb | undefined>((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      input.off('data', onData)
      resolve(parseBackgroundReply(received))
    }
    const onData = (chunk: Buffer | string): void => {
      received += chunk.toString()
      if (ATTRIBUTES.test(received)) finish()
    }
    const timer = setTimeout(finish, timeoutMs)
    input.on('data', onData)
  })
  output.write(`${ESC}]11;?\u0007${ESC}[c`)
  const color = await answer
  input.setRawMode(wasRaw)
  input.pause()
  return color
}
