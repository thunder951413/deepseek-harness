/** Terminal transcript settlement and control-sequence isolation. */
import { describe, expect, it } from 'vitest'
import type { JournalEvent } from '../src/port.ts'
import { terminalText } from '../src/transcript.ts'
import { TerminalTranscript, approvalCallText } from '../src/wire-transcript.ts'

function event(type: string, data: JournalEvent['data'], seq = 0): JournalEvent {
  return { type, data, seq }
}

describe('terminal transcript', () => {
  it('renders a shared conversation, tool activity, and failure without terminal escapes', () => {
    const transcript = new TerminalTranscript(10000)
    transcript.accept(event('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'Read the project' }] }))
    transcript.accept(event('tool/call', { name: 'read_file', callId: 'read-1', arguments: '{"path":"README.md"}' }, 1))
    transcript.accept(event('tool/result', { message: { toolCallId: 'read-1', isError: true,
      content: [{ type: 'text', text: '\x1b[2JFile not found' }] } }, 2))
    transcript.accept(event('assistant/message', { message: { content: [{ type: 'text', text: 'Choose another file.' }] } }, 3))
    transcript.accept(event('turn/end', { reason: { kind: 'completed' } }, 4))
    expect(transcript.view().entries).toEqual([
      { id: '0', seq: 0, kind: 'user', text: 'Read the project' },
      { id: '1', seq: 1, kind: 'tool', text: 'read_file(README.md)', state: 'failed', preview: ['File not found'],
        details: '{"path":"README.md"}\n\nFile not found' },
      { id: '3', seq: 3, kind: 'assistant', text: 'Choose another file.' },
    ])
    transcript.accept(event('turn/end', { reason: { kind: 'aborted' } }, 5))
    expect(transcript.view().entries.at(-1)).toMatchObject({ kind: 'status', text: 'aborted' })
  })

  it('settles a restored live answer once and clears it when switching sessions', () => {
    const transcript = new TerminalTranscript(100)
    transcript.restore([{ type: 'text-chunks', texts: ['unfinished'] }])
    expect(transcript.view().live).toBe('unfinished')
    transcript.accept(event('assistant/message', { message: { content: [{ type: 'text', text: 'finished' }] } }))
    expect(transcript.view()).toMatchObject({ live: '', entries: [{ kind: 'assistant', text: 'finished' }] })
    transcript.reset()
    expect(transcript.view()).toEqual({ entries: [], live: '', working: false })
  })

  it('bounds retained text and strips OSC hyperlinks and cursor commands', () => {
    const transcript = new TerminalTranscript(40)
    for (let seq = 0; seq < 100; seq++) transcript.accept(event('tool/call', { name: 'tool', arguments: 'x'.repeat(80) }, seq))
    const retained = transcript.view().entries.reduce((size, entry) => size + entry.text.length + (entry.details?.length ?? 0), 0)
    expect(retained).toBeLessThanOrEqual(40)
    expect(terminalText('\x1b]8;;https://invalid.test\x07safe\x1b]8;;\x07\x1b[2J\x00')).toBe('safe')
  })

  it('omits reasoning blocks and joins answer text and images', () => {
    const transcript = new TerminalTranscript(1000)
    transcript.accept(event('assistant/message', { message: { content: [
      { type: 'reasoning', text: 'considering' }, { type: 'text', text: 'Answer' }, { type: 'image' }, { type: 'other' },
    ] } }, 7))
    expect(transcript.view().entries).toEqual([{ id: '7', seq: 7, kind: 'assistant', text: 'Answer\n[image]' }])
    transcript.accept(event('assistant/message', { message: { content: 'plain' } }, 8))
    expect(transcript.view().entries.at(-1)).toMatchObject({ kind: 'assistant', text: 'plain' })
    transcript.accept(event('assistant/message', { message: { content: [{ type: 'reasoning', text: 'only thoughts' }] } }, 9))
    expect(transcript.view().entries).toHaveLength(2)
  })

  it('shows one task list per turn, updated in place, and hides the todo tool call', () => {
    const transcript = new TerminalTranscript(1000)
    transcript.accept(event('turn/start', {}, 1))
    transcript.accept(event('tool/call', { name: 'todo_write', callId: 't1', arguments: '{}' }, 2))
    transcript.accept(event('todo/write', { todos: [{ content: 'one', status: 'in_progress' }, { content: 'bad', status: 'later' }] }, 3))
    transcript.accept(event('tool/result', { message: { toolCallId: 't1', content: 'ok' } }, 4))
    transcript.accept(event('todo/write', { todos: [{ content: 'one', status: 'completed' }] }, 5))
    expect(transcript.view().entries).toEqual([{ id: '3', seq: 3, kind: 'todo', text: 'Todos', todos: [{ content: 'one', status: 'completed' }] }])
    transcript.accept(event('turn/start', {}, 6))
    transcript.accept(event('todo/write', { todos: 'broken' }, 7))
    expect(transcript.view().entries.map(entry => entry.id)).toEqual(['3', '7'])
  })

  it('shows one line per tool call, adding the first line of a failure only', () => {
    const transcript = new TerminalTranscript(2000)
    const args = JSON.stringify({ command: 'str_replace', path: '/p/a.ts', old_str: 'a', new_str: 'b' })
    transcript.accept(event('tool/call', { name: 'str_replace_editor', callId: 'e1', arguments: args }, 1))
    expect(transcript.view().entries[0]).toMatchObject({ text: 'Edit(/p/a.ts)', state: 'running' })
    expect(transcript.view().entries[0]).not.toHaveProperty('preview')
    transcript.accept(event('tool/result', { message: { toolCallId: 'e1', content: [{ type: 'text', text: 'done' }] } }, 2))
    expect(transcript.view().entries[0]).toMatchObject({ state: 'done' })
    expect(transcript.view().entries[0]).not.toHaveProperty('preview')
    transcript.accept(event('tool/call', { name: 'str_replace_editor', callId: 'e2', arguments: args }, 3))
    transcript.accept(event('tool/result', { message: { toolCallId: 'e2', isError: true, content: 'no match\nmore' } }, 4))
    expect(transcript.view().entries[1]).toMatchObject({ state: 'failed', preview: ['no match'] })
  })

  it('records a result whose call is no longer retained or was never seen as its own block', () => {
    const transcript = new TerminalTranscript(30)
    transcript.accept(event('tool/call', { name: 'bash', callId: 'b1', arguments: '{"command":"ls"}' }, 1))
    for (let seq = 2; seq < 6; seq++) transcript.accept(event('user/message', { source: { kind: 'user' }, content: 'x'.repeat(12) }, seq))
    transcript.accept(event('tool/result', { message: { toolCallId: 'b1', content: 'listing' } }, 9))
    expect(transcript.view().entries.at(-1)).toMatchObject({ id: '9', kind: 'tool', state: 'done', text: 'Bash(ls)' })
    transcript.accept(event('tool/result', { message: { toolCallId: 'unknown', content: 'orphan' } }, 10))
    expect(transcript.view().entries.at(-1)).toMatchObject({ text: 'unknown', state: 'done' })
  })

  it('reports interrupted attempts and turn errors with their details', () => {
    const transcript = new TerminalTranscript(1000)
    transcript.accept(event('assistant/attempt', { reason: 'cut' }, 1))
    transcript.accept(event('turn/end', { reason: { kind: 'error', error: { message: 'boom' } } }, 2))
    transcript.accept(event('turn/end', { reason: {} }, 3))
    expect(transcript.view().entries.map(entry => [entry.text, entry.details === undefined])).toEqual([
      ['Assistant attempt did not complete', false], ['error', false], ['Turn finished', true],
    ])
  })

  it('restores only text chunks of an unfinished attempt', () => {
    const transcript = new TerminalTranscript(1000)
    transcript.restore([{ type: 'text-chunks', texts: ['a', 'b'] }, { type: 'tool-call' }, { type: 'text-chunks' }])
    expect(transcript.view().live).toBe('ab')
  })

  it('tracks stream frames and ignores events it does not display', () => {
    const transcript = new TerminalTranscript(1000)
    transcript.stream({ type: 'start' })
    transcript.stream({ type: 'chunk', chunk: { type: 'text-delta', text: 'abc' } })
    transcript.stream({ type: 'chunk', chunk: { type: 'other' } })
    expect(transcript.view()).toMatchObject({ live: 'abc', working: true })
    transcript.stream({ type: 'end' })
    transcript.accept(event('user/message', { source: { kind: 'tool' }, content: 'hidden' }, 1))
    transcript.accept(event('future/event', {}, 2))
    expect(transcript.view()).toEqual({ entries: [], live: '', working: true })
  })

  it('finds the arguments of the call awaiting approval', () => {
    const call = event('tool/call', { name: 'bash', callId: 'c1', arguments: '{"command":"ls"}' })
    expect(approvalCallText(call, 'c1')).toBe('bash\n{"command":"ls"}')
    expect(approvalCallText(call, 'other')).toBeUndefined()
    expect(approvalCallText(event('turn/start', {}), 'c1')).toBeUndefined()
    expect(approvalCallText(event('tool/call', [1]), 'c1')).toBeUndefined()
  })

  it('answers a user-question reply as the user and leaves non-object payloads empty', () => {
    const transcript = new TerminalTranscript(1000)
    transcript.accept(event('user/message', { source: { kind: 'user-question-reply' }, content: [{ type: 'text', text: 'blue' }] }, 1))
    transcript.accept(event('assistant/message', 'broken', 2))
    transcript.accept(event('tool/call', 'broken', 3))
    transcript.accept(event('turn/end', [], 4))
    expect(transcript.view().entries.map(entry => entry.text)).toEqual(['blue', '', 'Turn finished'])
  })
})
