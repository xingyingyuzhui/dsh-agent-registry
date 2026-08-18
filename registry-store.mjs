// Durable workspace ↔ agent bindings. Pure + filesystem. No tool gating.

import { readFileSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { clampClawPolicy, declaredOf, INIT_PRESET, normalizePolicy, presetIdForWorkspace } from './registry-presets.mjs'
import { normalizeModel } from './registry-model.mjs'

export function defaultDshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

export function registryFile(home) {
  return join(home || defaultDshHome(), 'workspace-agents', 'registry.json')
}

export function agentIdForWorkspace(workspaceId) {
  return 'wa_' + String(workspaceId)
}

export function emptyRegistry(now = new Date().toISOString()) {
  return {
    version: 1,
    main: { agentId: 'main', createdAt: now },
    agents: {},
  }
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function normalizeRegistry(raw) {
  const value = asObject(raw)
  const main = asObject(value.main)
  const agentsIn = asObject(value.agents)
  const agents = {}
  for (const [key, row] of Object.entries(agentsIn)) {
    const agent = normalizeAgent(row, key)
    if (agent) agents[agent.agentId] = agent
  }
  return {
    version: 1,
    main: {
      agentId: 'main',
      createdAt: typeof main.createdAt === 'string' ? main.createdAt : new Date().toISOString(),
    },
    agents,
  }
}

export function normalizeAgent(raw, fallbackId) {
  const value = asObject(raw)
  const workspaceId = value.workspaceId != null ? String(value.workspaceId) : ''
  if (!workspaceId) return null
  const agentId = typeof value.agentId === 'string' && value.agentId
    ? value.agentId
    : (fallbackId || agentIdForWorkspace(workspaceId))
  const now = new Date().toISOString()
  return {
    agentId,
    workspaceId,
    canonicalRoot: typeof value.canonicalRoot === 'string' ? value.canonicalRoot : '',
    title: typeof value.title === 'string' ? value.title : '',
    slug: typeof value.slug === 'string' ? value.slug : '',
    kind: 'claw',
    preset: value.preset === undefined ? INIT_PRESET : String(value.preset),
    dshPreset: typeof value.dshPreset === 'string' && value.dshPreset
      ? value.dshPreset
      : presetIdForWorkspace(workspaceId),
    policyVersion: Number.isFinite(Number(value.policyVersion)) ? Number(value.policyVersion) : 1,
    policy: value.policy == null ? null : normalizePolicy(value.policy, value.preset === undefined ? INIT_PRESET : value.preset),
    model: normalizeModel(value.model),
    status: value.status === 'archived' ? 'archived' : 'active',
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
  }
}

export function refreshBinding(registry, workspace, now = new Date().toISOString()) {
  const workspaceId = String(workspace.id)
  const current = Object.values(registry.agents).find((row) => String(row.workspaceId) === workspaceId)
  if (!current) return { registry, agent: null, changed: false }
  const title = workspace.title != null ? String(workspace.title) : current.title
  const root = workspace.path != null ? String(workspace.path) : current.canonicalRoot
  if (title === current.title && root === current.canonicalRoot) {
    return { registry, agent: current, changed: false }
  }
  const agent = { ...current, title, canonicalRoot: root, updatedAt: now }
  return {
    registry: { ...registry, agents: { ...registry.agents, [current.agentId]: agent } },
    agent,
    changed: true,
  }
}

export function ensureBinding(registry, workspace, now = new Date().toISOString()) {
  const workspaceId = String(workspace.id)
  const agentId = agentIdForWorkspace(workspaceId)
  const current = registry.agents[agentId]
  if (current) {
    const title = workspace.title != null ? String(workspace.title) : current.title
    const root = workspace.path != null ? String(workspace.path) : current.canonicalRoot
    const dshPreset = current.dshPreset || presetIdForWorkspace(workspaceId)
    if (title === current.title && root === current.canonicalRoot && current.dshPreset === dshPreset) {
      return { registry, agent: current, created: false, changed: false }
    }
    const agent = { ...current, title, canonicalRoot: root, dshPreset, updatedAt: now }
    return {
      registry: { ...registry, agents: { ...registry.agents, [agentId]: agent } },
      agent,
      created: false,
      changed: true,
    }
  }
  const agent = {
    agentId,
    workspaceId,
    canonicalRoot: workspace.path != null ? String(workspace.path) : '',
    title: workspace.title != null ? String(workspace.title) : '',
    preset: INIT_PRESET,
    dshPreset: presetIdForWorkspace(workspaceId),
    policyVersion: 1,
    model: null,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  return {
    registry: { ...registry, agents: { ...registry.agents, [agentId]: agent } },
    agent,
    created: true,
    changed: true,
  }
}

export function setAgentPolicy(registry, agentId, policy, now = new Date().toISOString()) {
  const current = registry.agents[agentId]
  if (!current) return { registry, agent: null }
  const nextPolicy = clampClawPolicy(normalizePolicy(policy, current.preset))
  const agent = {
    ...current,
    preset: nextPolicy.preset,
    policy: nextPolicy,
    policyVersion: (Number(current.policyVersion) || 1) + 1,
    updatedAt: now,
  }
  return { registry: { ...registry, agents: { ...registry.agents, [agentId]: agent } }, agent }
}

export function setAgentModel(registry, agentId, selection, now = new Date().toISOString()) {
  const current = registry.agents[agentId]
  if (!current) return { registry, agent: null }
  const model = normalizeModel(selection)
  const agent = { ...current, model, updatedAt: now }
  return { registry: { ...registry, agents: { ...registry.agents, [agentId]: agent } }, agent }
}

export function setAgentSkills(registry, agentId, deny, now = new Date().toISOString()) {
  const current = registry.agents[agentId]
  if (!current) return { registry, agent: null }
  const base = clampClawPolicy(normalizePolicy(current.policy || { preset: current.preset }, current.preset))
  const names = Array.isArray(deny) ? deny.filter((item) => typeof item === 'string' && item) : []
  return setAgentPolicy(registry, agentId, { ...base, skills: { deny: names } }, now)
}

export function setStatus(registry, agentId, status, now = new Date().toISOString()) {
  const current = registry.agents[agentId]
  if (!current) return { registry, agent: null }
  if (current.status === status) return { registry, agent: current }
  const agent = { ...current, status, updatedAt: now }
  return { registry: { ...registry, agents: { ...registry.agents, [agentId]: agent } }, agent }
}

export function projectAgent(agent, workspace) {
  const declared = { ...clampClawPolicy(agent.policy ? normalizePolicy(agent.policy, agent.preset) : declaredOf(agent.preset)), enforced: false }
  const live = workspace != null
  return {
    ...agent,
    title: live ? workspace.title : agent.title,
    canonicalRoot: live ? workspace.path : agent.canonicalRoot,
    sessionIds: live && Array.isArray(workspace.sessionIds) ? workspace.sessionIds.slice() : [],
    sessionCount: live && Array.isArray(workspace.sessionIds) ? workspace.sessionIds.length : 0,
    workspacePresent: live,
    declared,
  }
}

export function loadRegistrySync(file) {
  try {
    return normalizeRegistry(JSON.parse(readFileSync(file, 'utf8')))
  } catch (error) {
    if (error && error.code === 'ENOENT') return emptyRegistry()
    throw error
  }
}

export async function loadRegistry(file) {
  try {
    const text = await readFile(file, 'utf8')
    return normalizeRegistry(JSON.parse(text))
  } catch (error) {
    if (error && error.code === 'ENOENT') return emptyRegistry()
    throw error
  }
}

export async function saveRegistry(file, registry) {
  const next = normalizeRegistry(registry)
  await mkdir(dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  await writeFile(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8')
  await rename(tmp, file)
  return next
}
