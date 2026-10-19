/** Tool summaries keep known tools informative and unknown tools readable. */
import { expect, it } from 'vitest'
import { resultPreview, toolCallView } from '../src/tool-view.ts'

it('summarizes shell commands by their first line', () => {
  expect(toolCallView('bash', JSON.stringify({ command: 'ls -la\nwc -l' }))).toEqual({ title: 'Bash(ls -la)', preview: [] })
})

it('summarizes editor commands and previews bounded changes', () => {
  const edit = toolCallView('str_replace_editor', JSON.stringify({ command: 'str_replace', path: '/a', old_str: 'x\n'.repeat(6), new_str: 'y' }))
  expect(edit.title).toBe('Edit(/a)')
  expect(edit.preview).toEqual(['- x', '- x', '- x', '- x', '- … +3 lines', '+ y'])
  expect(toolCallView('str_replace_editor', JSON.stringify({ command: 'view', path: '/a' })).title).toBe('Read(/a)')
  expect(toolCallView('str_replace_editor', JSON.stringify({ command: 'create', path: '/a', file_text: 'a\nb' })))
    .toEqual({ title: 'Write(/a)', preview: ['+ 2 lines'] })
  expect(toolCallView('str_replace_editor', JSON.stringify({ command: 'create', path: '/a' })).preview).toEqual(['+ 1 lines'])
  expect(toolCallView('str_replace_editor', JSON.stringify({ command: 'insert', path: '/a', new_str: 'z' })))
    .toEqual({ title: 'Insert(/a)', preview: ['+ z'] })
  expect(toolCallView('str_replace_editor', JSON.stringify({ command: 'insert', path: '/a' })).preview).toEqual(['+ '])
})

it('falls back to the tool name and a leading argument for unknown tools and bad arguments', () => {
  expect(toolCallView('search', JSON.stringify({ query: 'needle', limit: 3 })).title).toBe('search(needle)')
  expect(toolCallView('search', JSON.stringify({ limit: 3, label: 'first' })).title).toBe('search(first)')
  expect(toolCallView('search', JSON.stringify({ limit: 3 })).title).toBe('search')
  expect(toolCallView('search', 'not json').title).toBe('search')
  expect(toolCallView('search', '[1]').title).toBe('search')
  expect(toolCallView('bash', '{}').title).toBe('bash')
  expect(toolCallView('str_replace_editor', JSON.stringify({ command: 'bogus', path: '/a' })).title).toBe('str_replace_editor(/a)')
  expect(toolCallView('str_replace_editor', JSON.stringify({ command: 'view' })).title).toBe('str_replace_editor(view)')
  expect(toolCallView('x', JSON.stringify({ path: 'p'.repeat(200) })).title).toHaveLength(2 + 100 + 1)
})

it('removes control sequences and bounds result previews', () => {
  expect(resultPreview('\x1b[2Jone\n\n\ttwo')).toEqual(['one', '  two'])
  expect(resultPreview('1\n2\n3\n4\n5\n6')).toEqual(['1', '2', '3', '4', '… +2 lines · /tools'])
  expect(resultPreview('')).toEqual([])
})

it('handles blank commands, missing text fields, and arguments with only blank values', () => {
  expect(toolCallView('bash', JSON.stringify({ command: '   ' })).title).toBe('Bash()')
  expect(toolCallView('str_replace_editor', JSON.stringify({ command: 'str_replace', path: '/a' })).preview).toEqual(['- ', '+ '])
  expect(toolCallView('x', JSON.stringify({ a: '', b: 3 })).title).toBe('x')
})
