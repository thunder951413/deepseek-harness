/** Tool titles keep known tools informative and unknown tools readable on one line. */
import { expect, it } from 'vitest'
import { toolDetail, toolTitle } from '../src/tool-view.ts'

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

it('describes the invocation in at most three lines', () => {
  expect(toolDetail('bash', JSON.stringify({ command: 'ls -la\n\nwc -l\necho a\necho b' }))).toEqual(['ls -la', 'wc -l', 'echo a'])
  expect(toolDetail('str_replace_editor', JSON.stringify({ command: 'str_replace', path: '/a', old_str: 'old\nmore', new_str: 'new' })))
    .toEqual(['/a', '- old', '+ new'])
  expect(toolDetail('str_replace_editor', JSON.stringify({ command: 'insert', path: '/a', new_str: 'z' }))).toEqual(['/a', '+ z'])
  expect(toolDetail('str_replace_editor', JSON.stringify({ command: 'view', path: '/a' }))).toEqual(['/a'])
  expect(toolDetail('str_replace_editor', JSON.stringify({ command: 'str_replace', path: '/a' }))).toEqual(['/a'])
  expect(toolDetail('search', JSON.stringify({ query: 'needle\nline2', limit: 3, deep: { a: 1 }, extra: true })))
    .toEqual(['query: needle', 'limit: 3', 'deep: {"a":1}'])
  expect(toolDetail('search', 'not json')).toEqual([])
  expect(toolDetail('bash', JSON.stringify({ command: 'x'.repeat(300) }))[0]).toHaveLength(240)
  expect(toolDetail('bash', JSON.stringify({ command: 'a\tb' }))).toEqual(['a  b'])
})
