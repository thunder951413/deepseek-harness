/**
 * Terminal background detection and the block tints derived from it.
 * Each tint is the real background mixed with a little of one hue, so the blocks differ only
 * slightly from the surroundings on both dark and light terminals instead of using fixed colors.
 */

/** Red, green, and blue, each 0 to 255. */
export type Rgb = readonly [number, number, number]

/** `#rrggbb` colors behind each kind of block; an empty string means no tint. */
export interface Tints {
  readonly input: string
  readonly user: string
  readonly assistant: string
  readonly tools: string
}

const ESC = '\u001b'
const REPLY = new RegExp(`${ESC}\\]11;rgba?:([0-9a-fA-F]{1,4})/([0-9a-fA-F]{1,4})/([0-9a-fA-F]{1,4})`, 'u')

/** Background assumed when the user forces a dark appearance. */
export const DARK_BACKGROUND: Rgb = [0x1e, 0x1e, 0x1e]
/** Background assumed when the user forces a light appearance. */
export const LIGHT_BACKGROUND: Rgb = [0xff, 0xff, 0xff]

const BLUE: Rgb = [0x4c, 0x78, 0xc8]
const GREEN: Rgb = [0x3f, 0xa5, 0x6f]

function channel(digits: string): number {
  return Math.round(parseInt(digits, 16) / (16 ** digits.length - 1) * 255)
}

/**
 * Read the terminal's answer to an OSC 11 background query.
 * @param data - bytes received after the query.
 * @returns the background color, or undefined when the answer is absent or malformed.
 */
export function parseBackgroundReply(data: string): Rgb | undefined {
  const match = REPLY.exec(data)
  return match?.[1] === undefined || match[2] === undefined || match[3] === undefined ? undefined
    : [channel(match[1]), channel(match[2]), channel(match[3])]
}

/**
 * Guess the background from `COLORFGBG`, which some terminals set to `foreground;background` palette indexes.
 * @param env - process environment.
 * @returns a typical dark or light background, or undefined when the variable is absent or unreadable.
 */
export function backgroundFromEnvironment(env: NodeJS.ProcessEnv): Rgb | undefined {
  const index = Number((env.COLORFGBG ?? '').split(';').at(-1))
  if (!Number.isInteger(index) || index < 0 || index > 15 || (env.COLORFGBG ?? '') === '') return undefined
  return index === 7 || index >= 9 ? LIGHT_BACKGROUND : DARK_BACKGROUND
}

/**
 * Judge whether a color is light.
 * @param color - background color.
 * @returns true when its perceived brightness is above the middle.
 */
export function isLight(color: Rgb): boolean {
  return (0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2]) > 127.5
}

/**
 * Mix a tint into a base color.
 * @param base - starting color.
 * @param tint - color to mix in.
 * @param amount - share of the tint, 0 to 1.
 * @returns the mixed color as `#rrggbb`.
 */
export function mix(base: Rgb, tint: Rgb, amount: number): string {
  const part = (index: 0 | 1 | 2): string => Math.round(base[index] + (tint[index] - base[index]) * amount).toString(16).padStart(2, '0')
  return `#${part(0)}${part(1)}${part(2)}`
}

/**
 * Derive the block tints for a background.
 * @param background - the terminal background.
 * @returns a bluish tint for your messages, a faint neutral for answers, a greenish one for tools, and a neutral for the input.
 */
export function tintsFor(background: Rgb): Tints {
  const neutral: Rgb = isLight(background) ? [0, 0, 0] : [255, 255, 255]
  return { input: mix(background, neutral, 0.09), user: mix(background, BLUE, 0.18),
    assistant: mix(background, neutral, 0.04), tools: mix(background, GREEN, 0.1) }
}

/** Inputs for choosing the tints. */
export interface TintOptions {
  /** `auto` follows the detected background; the others assume a typical one. */
  readonly appearance: 'auto' | 'dark' | 'light'
  /** Background reported by the terminal, if it answered. */
  readonly detected: Rgb | undefined
  readonly env: NodeJS.ProcessEnv
  /** Colors set in the configuration; an empty string leaves that block to the derived tint. */
  readonly overrides: Tints
}

/**
 * Choose the tint of each block.
 * @param options - appearance setting, detected background, environment, and configured overrides.
 * @returns the tints; blocks have none when no background is known and nothing is configured.
 */
export function chooseTints(options: TintOptions): Tints {
  const background = options.appearance === 'dark' ? DARK_BACKGROUND : options.appearance === 'light' ? LIGHT_BACKGROUND
    : options.detected ?? backgroundFromEnvironment(options.env)
  const derived: Tints = background === undefined ? { input: '', user: '', assistant: '', tools: '' } : tintsFor(background)
  const { overrides } = options
  return { input: overrides.input || derived.input, user: overrides.user || derived.user,
    assistant: overrides.assistant || derived.assistant, tools: overrides.tools || derived.tools }
}
