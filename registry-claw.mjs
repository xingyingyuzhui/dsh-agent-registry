// Claw agents live under $DSH_HOME/DSclaw/<slug>, like OpenClaw workspaces.

import { mkdirSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
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

function existingRealpath(path) {
  let abs = resolve(String(path))
  const tail = []
  while (true) {
    try {
      const real = realpathSync(abs)
      return tail.length === 0 ? real : join(real, ...tail)
    } catch {
      const parent = dirname(abs)
      if (parent === abs) return abs
      tail.unshift(basename(abs))
      abs = parent
    }
  }
}

export function isClawHomePath(dshHome, path) {
  if (!dshHome || !path) return false
  const clawRoot = existingRealpath(join(String(dshHome), CLAW_DIR))
  const target = existingRealpath(path)
  const rel = relative(clawRoot, target)
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith('/')
}

export const AGENT_TITLE_MAX = 80

export function sanitizeAgentTitle(name) {
  const text = String(name || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > AGENT_TITLE_MAX ? text.slice(0, AGENT_TITLE_MAX).trim() : text
}

export function listClawSlugs(dshHome) {
  try {
    return readdirSync(clawHome(dshHome)).filter((name) => {
      if (!name || name.startsWith('.')) return false
      try {
        return statSync(join(clawHome(dshHome), name)).isDirectory()
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

export function reserveClawWorkspace(dshHome, slug) {
  mkdirSync(clawHome(dshHome), { recursive: true })
  const path = clawWorkspaceDir(dshHome, slug)
  try {
    mkdirSync(path)
  } catch (error) {
    if (!error || error.code !== 'EEXIST') throw error
    let names = []
    try { names = readdirSync(path) } catch { names = ['?'] }
    if (names.length > 0) {
      const err = new Error('workspace directory already exists')
      err.code = 'DSH_CLAW_EXISTS'
      throw err
    }
  }
  return path
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
