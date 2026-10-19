/** Tool titles keep known tools informative and unknown tools readable on one line. */
import { expect, it } from 'vitest'
import { failureLine, toolTitle } from '../src/tool-view.ts'

it('titles shell commands by their first line', () => {
  expect(toolTitle('bash', JSON.stringify({ command: 'ls -la\nwc -l' }))).toBe('Bash(ls -la)')
  expect(toolTitle('bash', JSON.stringify({ command: '   ' }))).toBe('Bash()')
})

it('titles editor commands by verb and path', () => {
  const title = (command: string) => toolTitle('str_replace_editor', JSON.stringify({ command, path: '/a' }))
  expect(['view', 'create', 'str_replace', 'insert'].map(title)).toEqual(['Read(/a)', 'Write(/a)', 'Edit(/a)', 'Insert(/a)'])
  expect(title('bogus')).toBe('str_replace_editor(/a)')
  expect(title('constructor')).toBe('str_replace_editor(/a)')
  expect(toolTitle('str_replace_editor', JSON.stringify({ command: 'view' }))).toBe('str_replace_editor(view)')
})

it('falls back to the tool name and a leading argument for unknown tools and bad arguments', () => {
  expect(toolTitle('search', JSON.stringify({ query: 'needle', limit: 3 }))).toBe('search(needle)')
  expect(toolTitle('search', JSON.stringify({ limit: 3, label: 'first' }))).toBe('search(first)')
  expect(toolTitle('search', JSON.stringify({ limit: 3 }))).toBe('search')
  expect(toolTitle('search', JSON.stringify({ a: '', b: 3 }))).toBe('search')
  expect(toolTitle('search', 'not json')).toBe('search')
  expect(toolTitle('search', '[1]')).toBe('search')
  expect(toolTitle('bash', '{}')).toBe('bash')
  expect(toolTitle('x', JSON.stringify({ path: 'p'.repeat(200) }))).toHaveLength(2 + 100 + 1)
})

it('removes control sequences and keeps only the first line of a failure', () => {
  expect(failureLine('\x1b[2J\n\n\tfirst\nsecond')).toEqual(['  first'])
  expect(failureLine('')).toEqual([])
})
