import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defaultDshHome, loadRegistry, registryFile, saveRegistry } from './registry-store.mjs'
import { defaultsFile, loadDefaultsSync } from '../dsh-agent-policy/policy-store.mjs'
import { clearClawDefault, normalizePolicy } from './registry-presets.mjs'
import { archiveAgent, explainAgent, identityPaths, listProjected, renameAgent, restoreAgent, syncBindings, updateAgentModel, updateAgentPolicy, updateAgentSkills } from './registry-logic.mjs'
import { listModelCatalog, normalizeModel } from './registry-model.mjs'
import {
  bindCreatedAgent,
  clawHome,
  isClawHomePath,
  listClawSlugs,
  purgeLegacyAgents,
  reserveClawWorkspace,
  sanitizeAgentTitle,
  seedFiles,
  slugFromName,
} from './registry-claw.mjs'
import { migrateClawLegacy } from './registry-migrate.mjs'
import { CODES, currentTraceId, operation, runWithTrace, setObserveHome } from '../dsh-observability/observe.mjs'

export const name = 'dsh-agent-registry'
export const inject = ['webServer', 'workspaceRegistry', 'agentPresets', 'settings']

const BODY_CAP = 65536
const LOOPBACK_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/
let dshHome = defaultDshHome()

const _internal = {
  setDshHome(dir) {
    dshHome = dir
    setObserveHome(dir)
  },
  getDshHome() { return dshHome },
  migrateOnApply: true,
}
export { _internal }

function runLegacyMigrate(ctx) {
  const op = operation({ plugin: 'dsh-agent-registry', feature: 'legacy', operation: 'migrate_claw_presets' })
  try {
    const result = migrateClawLegacy(dshHome)
    const changed = (result.quarantined && result.quarantined.length) || (result.sessions && result.sessions.length)
    if (!changed && result.skipped) return
    op.start()
    if (result.incomplete) {
      op.degraded(CODES.REGISTRY_LEGACY_MIGRATE_FAILED, {
        quarantined: result.quarantined.length,
        sessions: result.sessions.length,
        errors: (result.errors || []).length,
      })
    } else {
      op.success({
        code: CODES.REGISTRY_LEGACY_MIGRATED,
        quarantined: result.quarantined.length,
        sessions: result.sessions.length,
      })
    }
    if (changed && ctx.logger && typeof ctx.logger.info === 'function') {
      ctx.logger.info('dsh-agent-registry: migrated leftover wa-* (' + result.quarantined.length + ' presets, ' + result.sessions.length + ' sessions)')
    }
  } catch (error) {
    op.start()
    op.fail(CODES.REGISTRY_LEGACY_MIGRATE_FAILED, error)
    if (ctx.logger && typeof ctx.logger.warn === 'function') {
      ctx.logger.warn('dsh-agent-registry: leftover migrate failed: ' + (error && error.message ? error.message : error))
    }
  }
}

const writeJson = (res, status, body) => {
  const traceId = currentTraceId()
  const payload = body && typeof body === 'object' && traceId && body.traceId == null
    ? { ...body, traceId }
    : body
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(payload))
}

const readJsonBody = (req, cap = BODY_CAP) => new Promise((resolveBody, reject) => {
  let size = 0
  const chunks = []
  req.on('data', (chunk) => {
    size += chunk.length
    if (size > cap) {
      reject(new Error('body too large'))
      req.destroy()
      return
    }
    chunks.push(chunk)
  })
  req.on('end', () => {
    try {
      resolveBody(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')))
    } catch {
      reject(new Error('invalid json body'))
    }
  })
  req.on('error', reject)
})

const guard = (req, res) => {
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: 'method not allowed' })
    return false
  }
  const headers = req.headers || {}
  if (headers['x-dsh-agent-registry'] !== '1') {
    writeJson(res, 403, { ok: false, error: 'missing csrf header' })
    return false
  }
  const origin = headers.origin
  if (origin !== undefined && origin !== null && !LOOPBACK_ORIGIN.test(origin)) {
    writeJson(res, 403, { ok: false, error: 'origin not allowed' })
    return false
  }
  return true
}

function optionalService(ctx, key) {
  if (ctx && typeof ctx.get === 'function') {
    try {
      const got = ctx.get(key)
      if (got != null) return got
    } catch { /* not injected */ }
  }
  if (ctx && Object.prototype.hasOwnProperty.call(ctx, key)) return ctx[key]
  return undefined
}

function listWorkspaces(ctx) {
  try {
    const list = ctx.workspaceRegistry && typeof ctx.workspaceRegistry.list === 'function'
      ? ctx.workspaceRegistry.list()
      : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

async function guardClawDefault(ctx) {
  const presets = ctx.agentPresets
  if (presets == null) return
  try {
    await clearClawDefault(ctx.settings, presets.defaultId)
  } catch (error) {
    if (ctx.logger && typeof ctx.logger.warn === 'function') {
      ctx.logger.warn('dsh-agent-registry: could not clear claw default: ' + (error && error.message ? error.message : error))
    }
  }
}

async function removePreset(ctx, id) {
  const presets = ctx.agentPresets
  if (presets == null || typeof presets.remove !== 'function' || !id) return
  try {
    await presets.remove(id)
  } catch { /* already gone or shipped */ }
}

async function provisionPresets(ctx, registry) {
  await guardClawDefault(ctx)
  return registry
}

async function readSynced(ctx) {
  const file = registryFile(dshHome)
  const loaded = await loadRegistry(file)
  const purged = purgeLegacyAgents(loaded, dshHome)
  for (const agent of purged.removed) {
    await removePreset(ctx, agent.dshPreset)
  }
  const workspaces = listWorkspaces(ctx)
  const synced = syncBindings(purged.registry, workspaces)
  const provisioned = await provisionPresets(ctx, synced.registry, workspaces)
  const dirty = purged.changed || synced.changed || provisioned !== synced.registry
  const registry = dirty ? await saveRegistry(file, provisioned) : provisioned
  return { registry, workspaces }
}

export function apply(ctx) {
  if (_internal.migrateOnApply) runLegacyMigrate(ctx)

  const handle = (fn) => async (req, res) => runWithTrace(req, async () => {
    if (!guard(req, res)) return
    try {
      const body = await readJsonBody(req)
      await fn(req, res, body)
    } catch (error) {
      writeJson(res, 400, { ok: false, error: error && error.message ? error.message : 'bad request' })
    }
  })

  const optionalStops = []

  const routes = [
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-agent-registry/list',
      handler: handle(async (_req, res) => {
        const { registry, workspaces } = await readSynced(ctx)
        const projected = listProjected(registry, workspaces, dshHome)
        if (projected.main) projected.main.files = identityPaths(dshHome, 'main', projected.main)
        writeJson(res, 200, { ok: true, home: dshHome, clawHome: clawHome(dshHome), ...projected })
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-agent-registry/explain',
      handler: handle(async (_req, res, body) => {
        const { registry, workspaces } = await readSynced(ctx)
        const row = explainAgent(registry, workspaces, body || {})
        if (!row) {
          writeJson(res, 404, { ok: false, error: 'agent not found' })
          return
        }
        writeJson(res, 200, { ok: true, agent: row })
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-agent-registry/archive',
      handler: handle(async (_req, res, body) => {
        const agentId = body && body.agentId
        if (typeof agentId !== 'string' || !agentId.startsWith('wa_')) {
          writeJson(res, 400, { ok: false, error: 'invalid agent id' })
          return
        }
        const file = registryFile(dshHome)
        const loaded = await loadRegistry(file)
        const result = archiveAgent(loaded, agentId)
        if (!result.agent) {
          writeJson(res, 404, { ok: false, error: 'agent not found' })
          return
        }
        await saveRegistry(file, result.registry)
        writeJson(res, 200, { ok: true, agent: result.agent })
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-agent-registry/rename',
      handler: handle(async (_req, res, body) => {
        const agentId = body && body.agentId
        const title = sanitizeAgentTitle(body && body.name)
        const op = operation({ plugin: 'dsh-agent-registry', feature: 'agent', operation: 'rename_agent', agentId })
        op.start()
        if (typeof agentId !== 'string' || !agentId.startsWith('wa_') || !title) {
          op.reject(CODES.REGISTRY_RENAME_INVALID)
          writeJson(res, 400, { ok: false, error: 'invalid rename', code: CODES.REGISTRY_RENAME_INVALID })
          return
        }
        const file = registryFile(dshHome)
        const loaded = await loadRegistry(file)
        const result = renameAgent(loaded, agentId, title)
        if (!result.agent) {
          op.reject(CODES.REGISTRY_AGENT_NOT_FOUND)
          writeJson(res, 404, { ok: false, error: 'agent not found', code: CODES.REGISTRY_AGENT_NOT_FOUND })
          return
        }
        try {
          await saveRegistry(file, result.registry)
        } catch (error) {
          op.fail(CODES.REGISTRY_RENAME_FAILED, error, { state: 'clean' })
          writeJson(res, 500, { ok: false, error: 'rename save failed', code: CODES.REGISTRY_RENAME_FAILED })
          return
        }
        op.success({ agentId })
        writeJson(res, 200, { ok: true, agent: result.agent })
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-agent-registry/create',
      handler: handle(async (_req, res, body) => {
        const op = operation({ plugin: 'dsh-agent-registry', feature: 'agent', operation: 'create_agent' })
        op.start()
        const title = sanitizeAgentTitle(body && body.name)
        if (!title) {
          op.reject(CODES.REGISTRY_NAME_INVALID)
          writeJson(res, 400, { ok: false, error: 'name required', code: CODES.REGISTRY_NAME_INVALID })
          return
        }
        const file = registryFile(dshHome)
        const loaded = await loadRegistry(file)
        const disk = listClawSlugs(dshHome)
        const registrySlugs = new Set(Object.values(loaded.agents).map((row) => row.slug).filter(Boolean))
        const preferred = slugFromName(title, registrySlugs)
        const used = new Set([...registrySlugs, ...disk])
        const slug = slugFromName(title, used)
        const skippedOrphan = preferred !== slug
        let path
        try {
          op.stage('reserve_dir')
          path = reserveClawWorkspace(dshHome, slug)
        } catch (error) {
          op.reject(CODES.REGISTRY_WORKSPACE_EXISTS, { state: 'clean' })
          writeJson(res, 409, { ok: false, error: error && error.message ? error.message : 'workspace exists', code: CODES.REGISTRY_WORKSPACE_EXISTS })
          return
        }
        const files = seedFiles(title)
        await mkdir(join(path, 'memory'), { recursive: true })
        for (const [name, text] of Object.entries(files)) {
          await writeFile(join(path, name), text)
        }
        if (ctx.workspaceRegistry == null || typeof ctx.workspaceRegistry.create !== 'function') {
          op.fail(CODES.REGISTRY_CREATE_FAILED, new Error('workspace registry unavailable'), {
            state: 'partially_applied',
            remainingArtifacts: ['workspace_dir', 'identity_files'],
          })
          writeJson(res, 500, { ok: false, error: 'workspace registry unavailable', code: CODES.REGISTRY_CREATE_FAILED })
          return
        }
        const workspace = await ctx.workspaceRegistry.create(path, title)
        const dshPreset = 'wa-' + slug
        const bound = bindCreatedAgent(loaded, {
          workspaceId: workspace.id,
          slug,
          path: workspace.path || path,
          title: workspace.title || title,
          dshPreset,
        })
        const defaults = loadDefaultsSync(defaultsFile(dshHome))
        const seeded = updateAgentPolicy(bound.registry, bound.agent.agentId, normalizePolicy({
          preset: bound.agent.preset || 'research',
          mcp: defaults.mcp,
          servers: defaults.servers,
        }))
        const agent = seeded.agent || bound.agent
        op.stage('policy_write')
        try {
          if (agent.canonicalRoot && isClawHomePath(dshHome, agent.canonicalRoot) && agent.policy) {
            await writeFile(join(agent.canonicalRoot, 'policy.json'), JSON.stringify(agent.policy, null, 2) + '\n')
          }
        } catch (error) {
          op.fail(CODES.REGISTRY_POLICY_WRITE_FAILED, error, {
            state: 'partially_applied',
            remainingArtifacts: ['workspace_dir', 'identity_files'],
            agentId: agent.agentId,
          })
          writeJson(res, 500, { ok: false, error: 'policy write failed', code: CODES.REGISTRY_POLICY_WRITE_FAILED })
          return
        }
        op.stage('save_registry')
        try {
          await saveRegistry(file, seeded.registry || bound.registry)
        } catch (error) {
          op.fail(CODES.REGISTRY_SAVE_FAILED, error, {
            state: 'partially_applied',
            remainingArtifacts: ['workspace_dir', 'identity_files', 'policy_json'],
            agentId: agent.agentId,
          })
          writeJson(res, 500, { ok: false, error: 'registry save failed', code: CODES.REGISTRY_SAVE_FAILED })
          return
        }
        if (skippedOrphan) op.success({ agentId: agent.agentId, slug, code: CODES.REGISTRY_ORPHAN_SLUG_SKIPPED })
        else op.success({ agentId: agent.agentId, slug })
        writeJson(res, 200, { ok: true, agent, clawHome: clawHome(dshHome) })
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-agent-registry/diag',
      handler: handle(async (_req, res, body) => {
        const code = body && body.code
        if (code !== CODES.REGISTRY_RESPONSE_STALE) {
          writeJson(res, 400, { ok: false, error: 'unsupported diag code' })
          return
        }
        const op = operation({
          plugin: 'dsh-agent-registry',
          feature: 'settings',
          operation: (body && body.operation) || 'client_event',
        })
        op.start()
        op.degraded(CODES.REGISTRY_RESPONSE_STALE, { skipReason: 'stale', state: 'clean' })
        writeJson(res, 200, { ok: true })
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-agent-registry/policy',
      handler: handle(async (_req, res, body) => {
        const agentId = body && body.agentId
        if (typeof agentId !== 'string' || !agentId.startsWith('wa_')) {
          writeJson(res, 400, { ok: false, error: 'invalid agent id' })
          return
        }
        const file = registryFile(dshHome)
        const loaded = await loadRegistry(file)
        const op = operation({ plugin: 'dsh-agent-registry', feature: 'policy', operation: 'save_policy', agentId })
        op.start()
        const result = updateAgentPolicy(loaded, agentId, normalizePolicy(body && body.policy))
        if (!result.agent) {
          op.reject(CODES.REGISTRY_AGENT_NOT_FOUND)
          writeJson(res, 404, { ok: false, error: 'agent not found', code: CODES.REGISTRY_AGENT_NOT_FOUND })
          return
        }
        op.stage('policy_write')
        try {
          if (result.agent.canonicalRoot && isClawHomePath(dshHome, result.agent.canonicalRoot)) {
            await writeFile(join(result.agent.canonicalRoot, 'policy.json'), JSON.stringify(result.agent.policy, null, 2) + '\n')
          }
        } catch (error) {
          op.fail(CODES.REGISTRY_POLICY_WRITE_FAILED, error, { state: 'clean', agentId })
          writeJson(res, 500, { ok: false, error: 'policy write failed', code: CODES.REGISTRY_POLICY_WRITE_FAILED })
          return
        }
        try {
          await saveRegistry(file, result.registry)
        } catch (error) {
          op.fail(CODES.REGISTRY_SAVE_FAILED, error, {
            state: 'partially_applied',
            remainingArtifacts: ['policy_json'],
            agentId,
          })
          writeJson(res, 500, { ok: false, error: 'registry save failed', code: CODES.REGISTRY_SAVE_FAILED })
          return
        }
        op.success({ agentId })
        writeJson(res, 200, { ok: true, agent: result.agent })
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-agent-registry/skills',
      handler: handle(async (_req, res, body) => {
        const agentId = body && body.agentId
        if (typeof agentId !== 'string' || !agentId.startsWith('wa_')) {
          writeJson(res, 400, { ok: false, error: 'invalid agent id' })
          return
        }
        const file = registryFile(dshHome)
        const loaded = await loadRegistry(file)
        const result = updateAgentSkills(loaded, agentId, body && body.deny)
        if (!result.agent) {
          writeJson(res, 404, { ok: false, error: 'agent not found' })
          return
        }
        if (result.agent.canonicalRoot && isClawHomePath(dshHome, result.agent.canonicalRoot)) {
          await writeFile(join(result.agent.canonicalRoot, 'policy.json'), JSON.stringify(result.agent.policy, null, 2) + '\n')
        }
        await saveRegistry(file, result.registry)
        writeJson(res, 200, { ok: true, agent: result.agent })
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-agent-registry/models',
      handler: handle(async (_req, res) => {
        const official = normalizeModel(optionalService(ctx, 'agentDefaultModel') && optionalService(ctx, 'agentDefaultModel').currentSelection())
        const groups = await listModelCatalog(optionalService(ctx, 'llm'))
        writeJson(res, 200, { ok: true, official, groups })
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-agent-registry/model',
      handler: handle(async (_req, res, body) => {
        const agentId = body && body.agentId
        if (typeof agentId !== 'string' || !agentId.startsWith('wa_')) {
          writeJson(res, 400, { ok: false, error: 'invalid agent id' })
          return
        }
        const file = registryFile(dshHome)
        const loaded = await loadRegistry(file)
        const result = updateAgentModel(loaded, agentId, body && body.inherit === true ? null : body && body.model)
        if (!result.agent) {
          writeJson(res, 404, { ok: false, error: 'agent not found' })
          return
        }
        await saveRegistry(file, result.registry)
        writeJson(res, 200, { ok: true, agent: result.agent })
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-agent-registry/restore',
      handler: handle(async (_req, res, body) => {
        const agentId = body && body.agentId
        if (typeof agentId !== 'string' || !agentId.startsWith('wa_')) {
          writeJson(res, 400, { ok: false, error: 'invalid agent id' })
          return
        }
        const file = registryFile(dshHome)
        const loaded = await loadRegistry(file)
        const result = restoreAgent(loaded, agentId)
        if (!result.agent) {
          writeJson(res, 404, { ok: false, error: 'agent not found' })
          return
        }
        await saveRegistry(file, result.registry)
        writeJson(res, 200, { ok: true, agent: result.agent })
      }),
    }),
  ]

  ctx.effect(() => () => {
    for (const dispose of routes) {
      if (typeof dispose === 'function') dispose()
    }
    for (const stop of optionalStops) {
      if (typeof stop === 'function') stop()
    }
  })

  void guardClawDefault(ctx)
}
