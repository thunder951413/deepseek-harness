/** Tints are derived from the real background so blocks stay faint on dark and light terminals. */
import { expect, it } from 'vitest'
import {
  DARK_BACKGROUND, LIGHT_BACKGROUND, backgroundFromEnvironment, chooseTints, isLight, mix, parseBackgroundReply, tintsFor,
} from '../src/appearance.ts'

const NONE = { input: '', user: '', assistant: '', tools: '' }

it('reads the terminal answer in 8, 12, and 16 bit forms and ignores anything else', () => {
  expect(parseBackgroundReply('\u001b]11;rgb:1c/20/28\u0007')).toEqual([28, 32, 40])
  expect(parseBackgroundReply('\u001b]11;rgb:ffff/ffff/ffff\u001b\\')).toEqual([255, 255, 255])
  expect(parseBackgroundReply('x\u001b]11;rgba:0000/8000/ffff/ffff\u0007\u001b[?1;2c')).toEqual([0, 128, 255])
  expect(parseBackgroundReply('\u001b[?1;2c')).toBeUndefined()
  expect(parseBackgroundReply('')).toBeUndefined()
})

it('guesses a typical background from COLORFGBG', () => {
  expect(backgroundFromEnvironment({ COLORFGBG: '15;0' })).toBe(DARK_BACKGROUND)
  expect(backgroundFromEnvironment({ COLORFGBG: '0;15' })).toBe(LIGHT_BACKGROUND)
  expect(backgroundFromEnvironment({ COLORFGBG: '0;default;7' })).toBe(LIGHT_BACKGROUND)
  expect(backgroundFromEnvironment({ COLORFGBG: '15;8' })).toBe(DARK_BACKGROUND)
  expect(backgroundFromEnvironment({ COLORFGBG: 'default;default' })).toBeUndefined()
  expect(backgroundFromEnvironment({ COLORFGBG: '1;99' })).toBeUndefined()
  expect(backgroundFromEnvironment({ COLORFGBG: '' })).toBeUndefined()
  expect(backgroundFromEnvironment({})).toBeUndefined()
})

it('judges brightness and mixes without leaving the color range', () => {
  expect(isLight([255, 255, 255])).toBe(true)
  expect(isLight([20, 23, 28])).toBe(false)
  expect(isLight([128, 128, 128])).toBe(true)
  expect(mix([0, 0, 0], [255, 255, 255], 0.5)).toBe('#808080')
  expect(mix([10, 20, 30], [10, 20, 30], 1)).toBe('#0a141e')
  expect(mix([0, 0, 0], [255, 255, 255], 0)).toBe('#000000')
})

it('tints a dark background lighter and a light background darker, each block with its own hue', () => {
  const dark = tintsFor([20, 23, 28])
  expect(dark).toEqual({ input: '#292c30', user: '#1e283b', assistant: '#1d2025', tools: '#182524' })
  const light = tintsFor([255, 255, 255])
  expect(light).toEqual({ input: '#e8e8e8', user: '#dfe7f5', assistant: '#f5f5f5', tools: '#ecf6f1' })
  expect(new Set(Object.values(dark)).size).toBe(4)
})

it('follows the detected background, falls back to the environment, and applies configured overrides', () => {
  const overrides = NONE
  expect(chooseTints({ appearance: 'auto', detected: [255, 255, 255], env: {}, overrides })).toEqual(tintsFor([255, 255, 255]))
  expect(chooseTints({ appearance: 'auto', detected: undefined, env: { COLORFGBG: '0;15' }, overrides })).toEqual(tintsFor(LIGHT_BACKGROUND))
  expect(chooseTints({ appearance: 'auto', detected: undefined, env: {}, overrides })).toEqual(NONE)
  expect(chooseTints({ appearance: 'dark', detected: [255, 255, 255], env: {}, overrides })).toEqual(tintsFor(DARK_BACKGROUND))
  expect(chooseTints({ appearance: 'light', detected: undefined, env: {}, overrides })).toEqual(tintsFor(LIGHT_BACKGROUND))
  expect(chooseTints({ appearance: 'auto', detected: undefined, env: {}, overrides: { ...NONE, user: '#123456' } }))
    .toEqual({ ...NONE, user: '#123456' })
  expect(chooseTints({ appearance: 'dark', detected: undefined, env: {}, overrides: { ...NONE, tools: '#abcdef' } }).tools).toBe('#abcdef')
})
