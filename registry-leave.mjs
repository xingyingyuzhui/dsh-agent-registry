import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isDsClawPath } from './registry-view.mjs'
import { sameRoot } from './registry-logic.mjs'

export const LEAVE_BEHIND_IDS = ['archive', 'transfer', 'delete']

export function normalizeLeaveBehind(value) {
  return LEAVE_BEHIND_IDS.includes(value) ? value : 'archive'
}

export function setLeaveBehind(registry, mode) {
  const leaveBehind = normalizeLeaveBehind(mode)
  const settings = { ...(registry && registry.settings), leaveBehind }
  return { ...registry, settings }
}

export function isClawOfficialWorkspace(workspace, registry) {
  if (!workspace) return false
  if (isDsClawPath(workspace.path || workspace.cwd || '')) return true
  const id = workspace.id != null ? String(workspace.id) : ''
  if (!id || !registry || !registry.agents) return false
  return Object.values(registry.agents).some((agent) => agent && String(agent.workspaceId) === id)
}

export function clawOfficialWorkspaces(workspaces, registry) {
  return (Array.isArray(workspaces) ? workspaces : []).filter((row) => isClawOfficialWorkspace(row, registry))
}

export function profileHasBundle(pkg, id) {
  const bundles = pkg && pkg.dsh && pkg.dsh.profile && Array.isArray(pkg.dsh.profile.bundles)
    ? pkg.dsh.profile.bundles
    : []
  return bundles.includes(id)
}

export function shouldApplyLeaveBehind(pkg, id = 'dsh-agent-registry') {
  if (!pkg || !pkg.dsh || !pkg.dsh.profile || !Array.isArray(pkg.dsh.profile.bundles)) return false
  return !pkg.dsh.profile.bundles.includes(id)
}

export async function readProfilePackage(home, profile = 'web') {
  try {
    return JSON.parse(await readFile(join(home, 'profiles', profile, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

export function readProfilePackageSync(home, profile = 'web') {
  try {
    return JSON.parse(readFileSync(join(home, 'profiles', profile, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

export function workspaceStorePath(home) {
  return join(home, 'storages', 'workspace.json')
}

export function leavePlanPath(home) {
  return join(home, 'workspace-agents', 'leave-plan.json')
}

export function workspacesFromStore(store) {
  const table = store && store.tables && store.tables.workspaces
  if (!table || typeof table !== 'object') return []
  return Object.entries(table).map(([id, row]) => ({
    id,
    path: row && row.path,
    title: row && row.title,
    sessionIds: row && Array.isArray(row.sessionIds) ? row.sessionIds.slice() : [],
  }))
}

export function readWorkspaceStoreSync(home) {
  try {
    return JSON.parse(readFileSync(workspaceStorePath(home), 'utf8'))
  } catch {
    return null
  }
}

function writeJsonSync(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + '.' + process.pid + '.tmp'
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n')
  renameSync(tmp, file)
}

export function writeWorkspaceStoreSync(home, store) {
  writeJsonSync(workspaceStorePath(home), store)
}

export function snapshotLeaveRows(workspaces, registry) {
  return clawOfficialWorkspaces(workspaces, registry).map((row) => ({
    id: row.id != null ? String(row.id) : '',
    path: row.path || row.cwd || '',
    sessionIds: Array.isArray(row.sessionIds) ? row.sessionIds.map(String) : [],
  })).filter((row) => row.id || row.path)
}

export function writeLeavePlan(home, registry, workspaces) {
  const plan = {
    mode: normalizeLeaveBehind(registry && registry.settings && registry.settings.leaveBehind),
    workspaces: snapshotLeaveRows(workspaces, registry),
    updatedAt: new Date().toISOString(),
  }
  writeJsonSync(leavePlanPath(home), plan)
  return plan
}

export function readLeavePlan(home) {
  try {
    const raw = JSON.parse(readFileSync(leavePlanPath(home), 'utf8'))
    const workspaces = Array.isArray(raw && raw.workspaces) ? raw.workspaces : []
    return {
      mode: normalizeLeaveBehind(raw && raw.mode),
      workspaces: workspaces.filter((row) => row && (row.id || row.path)),
    }
  } catch {
    return null
  }
}

export function applyLeaveBehindToStore(store, rows) {
  if (!store || !store.global) return store
  const remove = new Set((Array.isArray(rows) ? rows : []).map((row) => String(row.id)).filter(Boolean))
  if (remove.size === 0) return store
  const archived = new Set(Array.isArray(store.global.archivedSessionIds) ? store.global.archivedSessionIds : [])
  const table = { ...((store.tables && store.tables.workspaces) || {}) }
  for (const row of rows) {
    const id = row && row.id != null ? String(row.id) : ''
    const rec = id ? table[id] : null
    const sessions = Array.isArray(row.sessionIds) && row.sessionIds.length
      ? row.sessionIds
      : (rec && Array.isArray(rec.sessionIds) ? rec.sessionIds : [])
    for (const sessionId of sessions) {
      if (sessionId) archived.add(String(sessionId))
    }
    if (id) delete table[id]
  }
  return {
    ...store,
    global: {
      ...store.global,
      workspaceIds: (store.global.workspaceIds || []).filter((id) => !remove.has(String(id))),
      archivedSessionIds: [...archived],
    },
    tables: { ...(store.tables || {}), workspaces: table },
  }
}

export function findSessionLogFiles(home, sessionId) {
  if (!sessionId) return []
  const root = join(home, 'sessions')
  const hit = []
  const walk = [root]
  while (walk.length) {
    const dir = walk.pop()
    let names
    try { names = readdirSync(dir) } catch { continue }
    for (const name of names) {
      const path = join(dir, name)
      let st
      try { st = statSync(path) } catch { continue }
      if (st.isDirectory()) {
        walk.push(path)
        continue
      }
      if ((name === 'session.jsonl' || name === 'session.jsonl.zstd') && dir.indexOf(String(sessionId)) >= 0) {
        hit.push(path)
      }
    }
  }
  return hit
}

function resolveLeaveRows({ home, registry, workspaces }) {
  const live = snapshotLeaveRows(workspaces, registry)
  if (live.length) return live
  const plan = readLeavePlan(home)
  if (plan && plan.workspaces.length) {
    return plan.workspaces.map((row) => ({
      id: row.id != null ? String(row.id) : '',
      path: row.path || '',
      sessionIds: Array.isArray(row.sessionIds) ? row.sessionIds.map(String) : [],
    }))
  }
  const store = readWorkspaceStoreSync(home)
  return snapshotLeaveRows(workspacesFromStore(store), registry)
}

export function applyLeaveBehindOffline({ home, registry, workspaces, mode }) {
  const leaveBehind = normalizeLeaveBehind(mode || (registry && registry.settings && registry.settings.leaveBehind))
  if (leaveBehind === 'transfer') {
    return { mode: 'transfer', workspaces: 0, sessions: 0, deletedLogs: 0 }
  }
  const rows = resolveLeaveRows({ home, registry, workspaces })
  const store = readWorkspaceStoreSync(home)
  if (store && rows.length) writeWorkspaceStoreSync(home, applyLeaveBehindToStore(store, rows))
  let sessions = 0
  let deletedLogs = 0
  for (const workspace of rows) {
    const ids = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []
    sessions += ids.length
    if (leaveBehind !== 'delete') continue
    for (const sessionId of ids) {
      for (const file of findSessionLogFiles(home, sessionId)) {
        try {
          rmSync(file)
          deletedLogs += 1
        } catch { /* skip */ }
      }
    }
  }
  return { mode: leaveBehind, workspaces: rows.length, sessions, deletedLogs }
}

export async function applyLeaveBehind({ home, registry, workspaces, workspaceRegistry, mode }) {
  const leaveBehind = normalizeLeaveBehind(mode || (registry && registry.settings && registry.settings.leaveBehind))
  const result = applyLeaveBehindOffline({ home, registry, workspaces, mode: leaveBehind })
  if (leaveBehind === 'transfer') return result
  const rows = resolveLeaveRows({ home, registry, workspaces })
  if (workspaceRegistry && typeof workspaceRegistry.delete === 'function') {
    for (const workspace of rows) {
      const ids = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []
      for (const sessionId of ids) {
        if (typeof workspaceRegistry.archiveSession === 'function') {
          try { await workspaceRegistry.archiveSession(sessionId) } catch { /* already archived */ }
        }
      }
      if (workspace.id) {
        try { await workspaceRegistry.delete(workspace.id) } catch { /* already gone */ }
      }
    }
  }
  return result
}

export async function ensureOfficialWorkspaces(ctx, registry) {
  const create = ctx && ctx.workspaceRegistry && ctx.workspaceRegistry.create
  if (typeof create !== 'function') return { created: 0, registry }
  const list = ctx.workspaceRegistry.list && ctx.workspaceRegistry.list()
  const workspaces = Array.isArray(list) ? list : []
  let next = registry
  let created = 0
  const agents = next && next.agents ? Object.values(next.agents) : []
  for (const agent of agents) {
    if (!agent || !agent.canonicalRoot) continue
    const exists = workspaces.some((row) => sameRoot(row.path, agent.canonicalRoot) || String(row.id) === String(agent.workspaceId))
    if (exists) continue
    try {
      const workspace = await create.call(ctx.workspaceRegistry, agent.canonicalRoot, agent.title || agent.slug)
      created += 1
      if (workspace && workspace.id && String(workspace.id) !== String(agent.workspaceId)) {
        const row = { ...agent, workspaceId: String(workspace.id) }
        next = { ...next, agents: { ...next.agents, [agent.agentId]: row } }
      }
    } catch { /* path missing or registry refused */ }
  }
  return { created, registry: next }
}
