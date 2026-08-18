// Join official workspaces with durable bindings. No permission changes.

import { realpathSync } from 'node:fs'
import { projectAgent, refreshBinding, setAgentModel, setAgentPolicy, setAgentSkills, setStatus } from './registry-store.mjs'

export function sameRoot(a, b) {
  if (!a || !b) return false
  if (a === b) return true
  try {
    return realpathSync(String(a)) === realpathSync(String(b))
  } catch {
    return false
  }
}

export function workspaceIndex(workspaces) {
  const byId = new Map()
  for (const workspace of workspaces || []) {
    if (workspace && workspace.id != null) byId.set(String(workspace.id), workspace)
  }
  return byId
}

export function syncBindings(registry, workspaces, now) {
  let next = registry
  let changed = false
  const created = []
  for (const workspace of workspaces || []) {
    if (workspace == null || workspace.id == null) continue
    const result = refreshBinding(next, workspace, now)
    next = result.registry
    if (result.changed) changed = true
  }
  return { registry: next, changed, created }
}

export function identityPaths(dshHome, agentId, agent) {
  const root = agent && agent.canonicalRoot
    ? String(agent.canonicalRoot)
    : [dshHome, 'workspace-agents', agentId].join('/').replace(/\/+/g, '/')
  return {
    root,
    agents: root + '/AGENTS.md',
    soul: root + '/SOUL.md',
    tools: root + '/TOOLS.md',
    identity: root + '/IDENTITY.md',
    user: root + '/USER.md',
    heartbeat: root + '/HEARTBEAT.md',
    memory: root + '/MEMORY.md',
    policy: root + '/policy.json',
  }
}

export function listProjected(registry, workspaces, dshHome) {
  const byId = workspaceIndex(workspaces)
  const rows = Object.values(registry.agents).map((agent) => {
    const projected = projectAgent(agent, byId.get(String(agent.workspaceId)))
    if (dshHome) projected.files = identityPaths(dshHome, agent.agentId, projected)
    return projected
  })
  rows.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1
    return String(a.title || a.canonicalRoot).localeCompare(String(b.title || b.canonicalRoot))
  })
  return {
    main: { ...registry.main, declared: { preset: 'main', enforced: false } },
    agents: rows,
  }
}

export function explainAgent(registry, workspaces, query) {
  const byId = workspaceIndex(workspaces)
  let agent = null
  if (query && query.agentId && registry.agents[query.agentId]) {
    agent = registry.agents[query.agentId]
  } else if (query && query.workspaceId) {
    agent = Object.values(registry.agents).find((row) => String(row.workspaceId) === String(query.workspaceId)) || null
  } else if (query && query.path) {
    agent = Object.values(registry.agents).find((row) => row.canonicalRoot === query.path || sameRoot(row.canonicalRoot, query.path)) || null
  }
  if (!agent) return null
  return projectAgent(agent, byId.get(String(agent.workspaceId)))
}

export function archiveAgent(registry, agentId, now) {
  return setStatus(registry, agentId, 'archived', now)
}

export function renameAgent(registry, agentId, title, now) {
  const current = registry.agents[agentId]
  if (!current) return { registry, agent: null }
  const nextTitle = String(title || '').trim()
  if (!nextTitle) return { registry, agent: null }
  if (nextTitle === current.title) return { registry, agent: current, changed: false, oldTitle: current.title }
  const agent = { ...current, title: nextTitle, updatedAt: now || new Date().toISOString() }
  return {
    registry: { ...registry, agents: { ...registry.agents, [agentId]: agent } },
    agent,
    changed: true,
    oldTitle: current.title,
  }
}

export function restoreAgent(registry, agentId, now) {
  return setStatus(registry, agentId, 'active', now)
}

export function updateAgentPolicy(registry, agentId, policy, now) {
  return setAgentPolicy(registry, agentId, policy, now)
}

export function updateAgentSkills(registry, agentId, deny, now) {
  return setAgentSkills(registry, agentId, deny, now)
}

export function updateAgentModel(registry, agentId, selection, now) {
  return setAgentModel(registry, agentId, selection, now)
}
