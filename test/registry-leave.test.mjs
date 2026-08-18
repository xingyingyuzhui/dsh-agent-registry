import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  applyLeaveBehind,
  applyLeaveBehindOffline,
  applyLeaveBehindToStore,
  isClawOfficialWorkspace,
  normalizeLeaveBehind,
  profileHasBundle,
  shouldApplyLeaveBehind,
  setLeaveBehind,
  writeLeavePlan,
} from '../registry-leave.mjs'
import { emptyRegistry, normalizeRegistry } from '../registry-store.mjs'

test('leave-behind defaults to archive', () => {
  assert.equal(normalizeLeaveBehind('nope'), 'archive')
  assert.equal(normalizeRegistry({}).settings.leaveBehind, 'archive')
  assert.equal(setLeaveBehind(emptyRegistry(), 'transfer').settings.leaveBehind, 'transfer')
})

test('profileHasBundle reads official bundle list', () => {
  assert.equal(profileHasBundle({ dsh: { profile: { bundles: ['dsh-agent-registry'] } } }, 'dsh-agent-registry'), true)
  assert.equal(profileHasBundle({ dsh: { profile: { bundles: [] } } }, 'dsh-agent-registry'), false)
  assert.equal(profileHasBundle(null, 'dsh-agent-registry'), false)
  assert.equal(shouldApplyLeaveBehind(null), false)
  assert.equal(shouldApplyLeaveBehind({ dsh: { profile: { bundles: ['dsh-agent-registry'] } } }), false)
  assert.equal(shouldApplyLeaveBehind({ dsh: { profile: { bundles: ['dsh-folded-chat'] } } }), true)
})

test('archive leave-behind deletes official claw workspaces and archives sessions', async () => {
  const deleted = []
  const archived = []
  const registry = {
    settings: { leaveBehind: 'archive' },
    agents: { wa_1: { agentId: 'wa_1', workspaceId: 'claw-1' } },
  }
  const workspaces = [
    { id: 'official', path: '/Users/qin/DSH', sessionIds: ['s-off'] },
    { id: 'claw-1', path: '/Users/qin/.dsh/DSclaw/test1', sessionIds: ['s-claw'] },
  ]
  const result = await applyLeaveBehind({
    home: '/tmp',
    registry,
    workspaces,
    workspaceRegistry: {
      async delete(id) { deleted.push(id); return true },
      async archiveSession(id) { archived.push(id) },
    },
  })
  assert.equal(result.mode, 'archive')
  assert.equal(result.workspaces, 1)
  assert.deepEqual(deleted, ['claw-1'])
  assert.deepEqual(archived, ['s-claw'])
})

test('transfer leave-behind does not touch official workspaces', async () => {
  const deleted = []
  const result = await applyLeaveBehind({
    home: '/tmp',
    registry: { settings: { leaveBehind: 'transfer' }, agents: {} },
    workspaces: [{ id: 'claw-1', path: '/Users/qin/.dsh/DSclaw/test1', sessionIds: ['s1'] }],
    workspaceRegistry: { async delete(id) { deleted.push(id) } },
    mode: 'transfer',
  })
  assert.equal(result.mode, 'transfer')
  assert.deepEqual(deleted, [])
})

test('delete leave-behind removes session logs and official rows', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dar-leave-'))
  const dir = join(home, 'sessions', 'bucket', 'session-deadbeef')
  await mkdir(dir, { recursive: true })
  const log = join(dir, 'session.jsonl')
  await writeFile(log, '{}\n')
  const deleted = []
  const result = await applyLeaveBehind({
    home,
    registry: { settings: { leaveBehind: 'delete' }, agents: {} },
    workspaces: [{ id: 'claw-1', path: join(home, 'DSclaw', 'x'), sessionIds: ['session-deadbeef'] }],
    workspaceRegistry: {
      async delete(id) { deleted.push(id) },
      async archiveSession() {},
    },
    mode: 'delete',
  })
  assert.equal(result.deletedLogs, 1)
  assert.deepEqual(deleted, ['claw-1'])
  await assert.rejects(() => import('node:fs/promises').then((fs) => fs.readFile(log)))
})

test('DSclaw path is a claw official workspace', () => {
  assert.equal(isClawOfficialWorkspace({ path: '/Users/qin/.dsh/DSclaw/test1' }, emptyRegistry()), true)
  assert.equal(isClawOfficialWorkspace({ path: '/Users/qin/DSH' }, emptyRegistry()), false)
})

test('store mutation archives sessions and drops claw rows', () => {
  const next = applyLeaveBehindToStore({
    unit: { name: 'workspace', version: 2 },
    global: {
      initialized: true,
      workspaceIds: ['official', 'claw-1'],
      archivedSessionIds: ['old'],
    },
    tables: {
      workspaces: {
        official: { path: '/tmp/proj', sessionIds: ['s-off'] },
        'claw-1': { path: '/tmp/DSclaw/x', sessionIds: ['s-claw'] },
      },
    },
  }, [{ id: 'claw-1', sessionIds: ['s-claw'] }])
  assert.deepEqual(next.global.workspaceIds, ['official'])
  assert.deepEqual(next.global.archivedSessionIds, ['old', 's-claw'])
  assert.equal(next.tables.workspaces['claw-1'], undefined)
  assert.ok(next.tables.workspaces.official)
})

test('offline leave-behind uses the saved plan when list is empty', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dar-leave-plan-'))
  const storePath = join(home, 'storages', 'workspace.json')
  await mkdir(join(home, 'storages'), { recursive: true })
  await writeFile(storePath, JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: ['keep', 'claw-1'], archivedSessionIds: [] },
    tables: {
      workspaces: {
        keep: { path: '/tmp/proj', sessionIds: ['s-off'] },
        'claw-1': { path: join(home, 'DSclaw', 'x'), sessionIds: ['s-claw'] },
      },
    },
  }))
  writeLeavePlan(home, { settings: { leaveBehind: 'archive' }, agents: {} }, [
    { id: 'claw-1', path: join(home, 'DSclaw', 'x'), sessionIds: ['s-claw'] },
  ])
  const result = applyLeaveBehindOffline({
    home,
    registry: { settings: { leaveBehind: 'archive' }, agents: {} },
    workspaces: [],
    mode: 'archive',
  })
  assert.equal(result.workspaces, 1)
  const store = JSON.parse(await readFile(storePath, 'utf8'))
  assert.deepEqual(store.global.workspaceIds, ['keep'])
  assert.deepEqual(store.global.archivedSessionIds, ['s-claw'])
})
