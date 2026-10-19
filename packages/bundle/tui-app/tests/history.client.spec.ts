/** `/resume` lists only the conversations of the directory the terminal was started in. */
import { mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { sessionsIn } from '../src/history.ts'
import { SessionId, type SessionSummary } from '../src/port.ts'

const row = (id: string, cwd?: string): SessionSummary => ({
  id: SessionId(id), updatedAt: 0, running: false, ...cwd === undefined ? {} : { cwd },
})

it('keeps conversations from the same physical directory and drops the rest', async ({ onTestFinished }) => {
  const root = await mkdtemp(join(tmpdir(), 'tui-history-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  await mkdir(join(root, 'project'))
  await mkdir(join(root, 'project', 'child'))
  await mkdir(join(root, 'other'))
  await symlink(join(root, 'project'), join(root, 'link'))
  const project = await realpath(join(root, 'project'))
  const kept = await sessionsIn(project, [
    row('exact', project), row('symlinked', join(root, 'link')), row('child', join(project, 'child')),
    row('other', join(root, 'other')), row('unknown'), row('trailing', `${project}/`),
  ])
  expect(kept.map(session => session.id)).toEqual(['exact', 'symlinked', 'trailing'])
})

it('matches a directory that no longer exists by its own path', async () => {
  const gone = join(tmpdir(), 'tui-history-gone-directory')
  expect((await sessionsIn(gone, [row('same', gone), row('different', join(tmpdir(), 'elsewhere'))])).map(session => session.id)).toEqual(['same'])
})
