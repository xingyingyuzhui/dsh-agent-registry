// Claw agents live under $DSH_HOME/DSclaw/<slug>, like OpenClaw workspaces.

import { join, relative, resolve } from 'node:path'
import {
  isStockAgentsSeed,
  refreshSeedFiles,
  seedFiles,
  seedNeedsRefresh,
} from './registry-seeds.mjs'

export { isStockAgentsSeed, refreshSeedFiles, seedFiles, seedNeedsRefresh }

export const CLAW_DIR = 'DSclaw'

export function clawHome(dshHome) {
  return join(dshHome, CLAW_DIR)
}

export function clawWorkspaceDir(dshHome, slug) {
  return join(clawHome(dshHome), slug)
}

export function isClawHomePath(dshHome, path) {
  if (!dshHome || !path) return false
  const home = resolve(String(dshHome))
  const target = resolve(String(path))
  const rel = relative(join(home, CLAW_DIR), target)
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith('/')
}

export function slugFromName(name, used) {
  const taken = used instanceof Set ? used : new Set(used || [])
  const trimmed = String(name || '').trim().toLowerCase()
  let base = trimmed.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (!base || !/^[a-z0-9]/.test(base)) base = 'claw'
  if (base.length > 48) base = base.slice(0, 48).replace(/-+$/, '')
  let slug = base
  let n = 2
  while (taken.has(slug)) {
    slug = base + '-' + n
    n += 1
  }
  return slug
}

export function rewriteIdentityHeading(text, oldTitle, newTitle) {
  if (typeof text !== 'string' || !oldTitle || !newTitle || oldTitle === newTitle) return text
  const esc = String(oldTitle).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp('^(#\\s*)' + esc + '(?=\\s|$)', 'm'), '$1' + newTitle)
}

export function isLegacyClawAgent(dshHome, agent) {
  if (agent == null) return false
  const root = agent.canonicalRoot
  if (!root) return true
  return !isClawHomePath(dshHome, root)
}

export function purgeLegacyAgents(registry, dshHome) {
  const agents = {}
  const removed = []
  for (const [id, agent] of Object.entries(registry.agents || {})) {
    if (isLegacyClawAgent(dshHome, agent)) {
      removed.push(agent)
      continue
    }
    agents[id] = agent
  }
  if (removed.length === 0) {
    return { registry, removed, changed: false }
  }
  return {
    registry: { ...registry, agents },
    removed,
    changed: true,
  }
}

export function bindCreatedAgent(registry, spec, now = new Date().toISOString()) {
  const workspaceId = String(spec.workspaceId)
  const agentId = spec.agentId || ('wa_' + workspaceId)
  const agent = {
    agentId,
    workspaceId,
    slug: spec.slug,
    kind: 'claw',
    canonicalRoot: spec.path,
    title: spec.title,
    preset: spec.preset || 'research',
    dshPreset: spec.dshPreset,
    policyVersion: 1,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  return {
    registry: { ...registry, agents: { ...registry.agents, [agentId]: agent } },
    agent,
  }
}
