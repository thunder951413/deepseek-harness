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
      { id: '1', seq: 1, kind: 'tools', text: '1 tool call · 1 failed', group: { count: 1, failed: 1, calls: [
        { id: 'read-1', argumentLength: 20, title: 'read_file(README.md)', state: 'failed', detail: ['path: README.md'], details: '{"path":"README.md"}\n\nFile not found' },
      ] } },
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
    expect(transcript.view()).toEqual({ entries: [], live: '', working: false, activity: { phase: 'Waiting for model', calls: 0, failed: 0 } })
  })

  it('bounds retained text and strips OSC hyperlinks and cursor commands', () => {
    const transcript = new TerminalTranscript(40)
    for (let seq = 0; seq < 100; seq++) transcript.accept(event('tool/call', { name: 'tool', arguments: 'x'.repeat(80) }, seq))
    const retained = transcript.view().entries.reduce((size, entry) => size + entry.text.length + (entry.details?.length ?? 0)
      + (entry.group?.calls ?? []).reduce((total, call) => total + call.title.length + call.details.length, 0), 0)
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

  it('groups consecutive tool calls into one entry that updates in place', () => {
    const transcript = new TerminalTranscript(5000)
    transcript.accept(event('turn/start', {}, 1))
    transcript.accept(event('tool/call', { name: 'bash', callId: 'a', arguments: '{"command":"ls"}' }, 2))
    transcript.accept(event('tool/call', { name: 'bash', callId: 'b', arguments: '{"command":"pwd"}' }, 3))
    expect(transcript.view().entries).toHaveLength(1)
    expect(transcript.view().entries[0]).toMatchObject({ id: '2', text: '2 tool calls', group: { count: 2, failed: 0 } })
    transcript.accept(event('tool/result', { message: { toolCallId: 'a', content: 'one' } }, 4))
    transcript.accept(event('tool/result', { message: { toolCallId: 'b', isError: true, content: 'two' } }, 5))
    expect(transcript.view().entries[0]).toMatchObject({ text: '2 tool calls · 1 failed',
      group: { failed: 1, calls: [{ id: 'a', state: 'done' }, { id: 'b', state: 'failed' }] } })
    expect(transcript.view().activity).toMatchObject({ calls: 2, failed: 1, latest: { id: 'b', state: 'failed', title: 'Bash(pwd)' } })
    transcript.accept(event('assistant/message', { message: { content: 'narration' } }, 6))
    transcript.accept(event('tool/call', { name: 'bash', callId: 'c', arguments: '{"command":"date"}' }, 7))
    expect(transcript.view().entries.map(entry => entry.text)).toEqual(['2 tool calls · 1 failed', 'narration', '1 tool call'])
    expect(transcript.view().activity).toMatchObject({ calls: 3, failed: 1, latest: { id: 'c', state: 'running' } })
    transcript.accept(event('turn/start', {}, 8))
    expect(transcript.view().activity).toEqual({ phase: 'Waiting for model', calls: 0, failed: 0 })
  })

  it('keeps the latest call current only while its own result arrives, and ignores results of unknown calls', () => {
    const transcript = new TerminalTranscript(5000)
    transcript.accept(event('tool/call', { name: 'bash', callId: 'a', arguments: '{"command":"ls"}' }, 1))
    transcript.accept(event('tool/call', { name: 'bash', callId: 'b', arguments: '{"command":"pwd"}' }, 2))
    transcript.accept(event('tool/result', { message: { toolCallId: 'a', content: 'x' } }, 3))
    expect(transcript.view().activity.latest).toMatchObject({ id: 'b', state: 'running' })
    transcript.accept(event('tool/result', { message: { toolCallId: 'unknown', content: 'orphan' } }, 4))
    expect(transcript.view().entries).toHaveLength(1)
  })

  it('caps the calls a group lists while counting every call, and drops results for trimmed groups', () => {
    const transcript = new TerminalTranscript(1_000_000)
    for (let index = 0; index < 120; index++) {
      transcript.accept(event('tool/call', { name: 'bash', callId: `c${String(index)}`, arguments: '{"command":"ls"}' }, index))
    }
    const group = transcript.view().entries[0]
    expect(group?.group?.count).toBe(120)
    expect(group?.group?.calls).toHaveLength(100)
    const small = new TerminalTranscript(30)
    small.accept(event('tool/call', { name: 'bash', callId: 'x', arguments: '{"command":"ls"}' }, 1))
    small.accept(event('user/message', { source: { kind: 'user' }, content: 'y'.repeat(40) }, 2))
    small.accept(event('tool/result', { message: { toolCallId: 'x', content: 'late' } }, 3))
    expect(small.view().entries.map(entry => entry.kind)).toEqual(['user'])
  })

  it('starts a new task list when the previous one was trimmed away', () => {
    const transcript = new TerminalTranscript(40)
    transcript.accept(event('todo/write', { todos: [{ content: 'one', status: 'pending' }] }, 1))
    transcript.accept(event('user/message', { source: { kind: 'user' }, content: 'x'.repeat(60) }, 2))
    expect(transcript.view().entries.map(entry => entry.kind)).toEqual(['user'])
    transcript.accept(event('todo/write', { todos: [{ content: 'two', status: 'pending' }] }, 3))
    expect(transcript.view().entries.map(entry => `${entry.kind}:${entry.id}`)).toEqual(['todo:3'])
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
    expect(transcript.view()).toEqual({ entries: [], live: '', working: true, activity: { phase: 'Receiving response', calls: 0, failed: 0 } })
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
    expect(transcript.view().entries.map(entry => entry.text)).toEqual(['blue', '1 tool call', 'Turn finished'])
  })
})

it('marks clipped tool output and records the sanitized argument split', () => {
  const transcript = new TerminalTranscript(90)
  transcript.accept(event('tool/call', { name: 'bash', callId: 'a', arguments: '{"command":"ls"}' }, 1))
  transcript.accept(event('tool/result', { message: { toolCallId: 'a', content: [{ type: 'text', text: 'x'.repeat(200) }] } }, 2))
  expect(transcript.view().clipped).toBe(true)
  const call = transcript.view().entries[0]?.group?.calls[0]
  expect(call).toMatchObject({ argumentLength: 16, truncated: true })
  expect(call?.details.slice(0, call.argumentLength)).toBe('{"command":"ls"}')
})

it('tracks the work phase, keeps the latest call when an earlier one finishes, and marks streamed text it clips', () => {
  const transcript = new TerminalTranscript(200)
  transcript.accept(event('turn/start', { turn: 1 }, 1))
  transcript.stream({ type: 'chunk', chunk: { type: 'text-delta', text: 'abcdef' } })
  expect(transcript.view().activity.phase).toBe('Receiving response')
  transcript.accept(event('step/start', {}, 2))
  expect(transcript.view().activity.phase).toBe('Waiting for model')
  transcript.accept(event('tool/call', { name: 'bash', callId: 'a', arguments: '{}' }, 3))
  transcript.accept(event('tool/call', { name: 'bash', callId: 'b', arguments: '{}' }, 4))
  transcript.accept(event('tool/result', { message: { toolCallId: 'a', content: [{ type: 'text', text: 'ok' }] } }, 5))
  expect(transcript.view().activity.latest?.id).toBe('b')
  expect(transcript.view().clipped).toBeUndefined()
  transcript.stream({ type: 'chunk', chunk: { type: 'text-delta', text: 'x'.repeat(250) } })
  expect(transcript.view().clipped).toBe(true)
})

it('records a result that arrives after its tool block stopped being the open one', () => {
  const transcript = new TerminalTranscript(1000)
  transcript.accept(event('turn/start', { turn: 1 }, 1))
  transcript.accept(event('tool/call', { name: 'bash', callId: 'late', arguments: '{}' }, 2))
  transcript.accept(event('turn/start', { turn: 2 }, 3))
  transcript.accept(event('tool/result', { message: { toolCallId: 'late', content: [{ type: 'text', text: 'done' }] } }, 4))
  expect(transcript.view().entries[0]?.group?.calls[0]?.state).toBe('done')
})
