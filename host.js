import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defaultDshHome, loadRegistry, loadRegistrySync, registryFile, saveRegistry } from './registry-store.mjs'
import { defaultsFile, loadDefaultsSync } from '../dsh-agent-policy/policy-store.mjs'
import { clearClawDefault, ensureGeneratedPreset, ensureOpenPersona, ensureTemplateNamed, fallbackMissingPreset, mountWithClawFallback, normalizePolicy, repairIsolatedMinimalClones } from './registry-presets.mjs'
import { archiveAgent, explainAgent, identityPaths, listProjected, renameAgent, restoreAgent, syncBindings, updateAgentModel, updateAgentPolicy, updateAgentSkills } from './registry-logic.mjs'
import { listModelCatalog, modelOfAgent, normalizeModel, resolveBlankSelection } from './registry-model.mjs'
import {
  bindCreatedAgent,
  clawHome,
  clawWorkspaceDir,
  purgeLegacyAgents,
  seedFiles,
  slugFromName,
} from './registry-claw.mjs'

export const name = 'dsh-agent-registry'
export const inject = ['webServer', 'workspaceRegistry', 'agentPresets', 'settings']

const BODY_CAP = 65536
const LOOPBACK_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/
let dshHome = defaultDshHome()

let officialSelection = () => null

const _internal = {
  setDshHome(dir) { dshHome = dir },
  getDshHome() { return dshHome },
  readOfficialSelection() { return officialSelection() },
}
export { _internal }

const writeJson = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
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

function wrapMethod(obj, key, wrapper) {
  if (!obj || typeof obj[key] !== 'function') return function () {}
  const orig = obj[key]
  obj[key] = function wrapped(...args) {
    return wrapper.call(this, orig, ...args)
  }
  return function () {
    if (obj[key] !== orig) obj[key] = orig
  }
}

function pinAgentDefaultModel(ctx) {
  const defaults = optionalService(ctx, 'agentDefaultModel')
  const agents = optionalService(ctx, 'agents')
  if (!defaults || typeof defaults.currentSelection !== 'function') return function () {}
  const stack = []
  let lastGet = null
  const peek = () => (stack.length ? stack[stack.length - 1] : lastGet)
  const official = defaults.currentSelection.bind(defaults)
  officialSelection = official
  defaults.currentSelection = function currentSelection() {
    const agent = peek()
    const claw = modelOfAgent(loadRegistrySync(registryFile(dshHome)), agent)
    return resolveBlankSelection(agent, official(), claw)
  }
  const stopGet = wrapMethod(agents, 'get', function (orig, id) {
    const agent = orig.call(this, id)
    if (agent) lastGet = agent
    return agent
  })
  function track(agent, next) {
    if (typeof next !== 'function') return undefined
    if (agent) stack.push(agent)
    const done = () => {
      if (agent && stack[stack.length - 1] === agent) stack.pop()
    }
    try {
      const result = next()
      return Promise.resolve(result).then((value) => {
        done()
        return value
      }, (error) => {
        done()
        throw error
      })
    } catch (error) {
      done()
      throw error
    }
  }
  const stopPre = typeof ctx.on === 'function'
    ? ctx.on('agent/pre-step', (payload, next) => track(payload && payload.agent, next))
    : function () {}
  const stopAssemble = typeof ctx.on === 'function'
    ? ctx.on('system-prompt/assemble', (_assembly, context, next) => track(context && context.agent, next))
    : function () {}
  return function () {
    defaults.currentSelection = official
    officialSelection = () => null
    stopGet()
    if (typeof stopPre === 'function') stopPre()
    if (typeof stopAssemble === 'function') stopAssemble()
  }
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

function pinMissingPresets(ctx) {
  const presets = ctx.agentPresets
  if (!presets || typeof presets.resolve !== 'function' || typeof presets.list !== 'function') {
    return function () {}
  }
  const remap = async (id) => {
    if (id == null || id === '') return id
    const list = await presets.list()
    const ids = new Set((list || []).map((row) => row && row.id).filter(Boolean))
    return fallbackMissingPreset(id, ids, presets.defaultId || 'standard')
  }
  const origResolve = presets.resolve.bind(presets)
  const origMount = typeof presets.mount === 'function' ? presets.mount.bind(presets) : null
  const origRecompose = typeof presets.recompose === 'function' ? presets.recompose.bind(presets) : null
  const origStanding = typeof presets.standingKeyFor === 'function' ? presets.standingKeyFor.bind(presets) : null
  presets.resolve = async function resolve(id) {
    return origResolve(await remap(id))
  }
  if (origMount) {
    presets.mount = async function mount(agentCtx, id) {
      return mountWithClawFallback(origMount, await remap(id), agentCtx, presets.defaultId || 'standard')
    }
  }
  if (origRecompose) {
    presets.recompose = async function recompose(agentCtx, id) {
      return mountWithClawFallback(origRecompose, await remap(id), agentCtx, presets.defaultId || 'standard')
    }
  }
  if (origStanding) {
    presets.standingKeyFor = async function standingKeyFor(id) {
      return origStanding(await remap(id))
    }
  }
  return function () {
    presets.resolve = origResolve
    if (origMount) presets.mount = origMount
    if (origRecompose) presets.recompose = origRecompose
    if (origStanding) presets.standingKeyFor = origStanding
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

async function provisionPresets(ctx, registry, workspaces) {
  const presets = ctx.agentPresets
  if (presets == null || typeof presets.copy !== 'function') return registry
  const next = registry
  try {
    await repairIsolatedMinimalClones(presets, { readFile, writeFile })
  } catch (error) {
    if (ctx.logger && typeof ctx.logger.warn === 'function') {
      ctx.logger.warn('dsh-agent-registry: preset repair failed: ' + (error && error.message ? error.message : error))
    }
  }
  for (const agent of Object.values(next.agents)) {
    if (agent == null || agent.status === 'archived') continue
    const id = agent.dshPreset
    if (!id) continue
    try {
      await ensureGeneratedPreset(presets, { id, name: agent.title || id })
    } catch (error) {
      if (ctx.logger && typeof ctx.logger.warn === 'function') {
        ctx.logger.warn('dsh-agent-registry: preset provision failed: ' + (error && error.message ? error.message : error))
      }
    }
  }
  try {
    await ensureTemplateNamed(presets, { readFile, writeFile })
    await ensureOpenPersona(presets, { readFile, writeFile })
  } catch (error) {
    if (ctx.logger && typeof ctx.logger.warn === 'function') {
      ctx.logger.warn('dsh-agent-registry: template rename failed: ' + (error && error.message ? error.message : error))
    }
  }
  await guardClawDefault(ctx)
  return next
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
  const handle = (fn) => async (req, res) => {
    if (!guard(req, res)) return
    try {
      const body = await readJsonBody(req)
      await fn(req, res, body)
    } catch (error) {
      writeJson(res, 400, { ok: false, error: error && error.message ? error.message : 'bad request' })
    }
  }

  const optionalStops = [pinMissingPresets(ctx)]
  if (typeof ctx.inject === 'function') {
    ctx.inject(['agentDefaultModel', 'agents'], (sub) => {
      const stop = pinAgentDefaultModel(sub)
      sub.effect(() => () => stop())
    })
  } else {
    optionalStops.push(pinAgentDefaultModel(ctx))
  }

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
        const title = body && typeof body.name === 'string' ? body.name.trim() : ''
        if (typeof agentId !== 'string' || !agentId.startsWith('wa_') || !title) {
          writeJson(res, 400, { ok: false, error: 'invalid rename' })
          return
        }
        const file = registryFile(dshHome)
        const loaded = await loadRegistry(file)
        const result = renameAgent(loaded, agentId, title)
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
      path: '/dsh-agent-registry/create',
      handler: handle(async (_req, res, body) => {
        const title = body && typeof body.name === 'string' ? body.name.trim() : ''
        if (!title) {
          writeJson(res, 400, { ok: false, error: 'name required' })
          return
        }
        const file = registryFile(dshHome)
        const loaded = await loadRegistry(file)
        const used = new Set(Object.values(loaded.agents).map((row) => row.slug).filter(Boolean))
        const slug = slugFromName(title, used)
        const path = clawWorkspaceDir(dshHome, slug)
        await mkdir(path, { recursive: true })
        const files = seedFiles(title)
        await mkdir(join(path, 'memory'), { recursive: true })
        for (const [name, text] of Object.entries(files)) {
          await writeFile(join(path, name), text)
        }
        if (ctx.workspaceRegistry == null || typeof ctx.workspaceRegistry.create !== 'function') {
          writeJson(res, 500, { ok: false, error: 'workspace registry unavailable' })
          return
        }
        const workspace = await ctx.workspaceRegistry.create(path, title)
        const dshPreset = 'wa-' + slug
        await ensureGeneratedPreset(ctx.agentPresets, { id: dshPreset, name: title })
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
        await saveRegistry(file, seeded.registry || bound.registry)
        if (agent.canonicalRoot && String(agent.canonicalRoot).indexOf('DSclaw') >= 0 && agent.policy) {
          try {
            await writeFile(join(agent.canonicalRoot, 'policy.json'), JSON.stringify(agent.policy, null, 2) + '\n')
          } catch { /* directory missing */ }
        }
        writeJson(res, 200, { ok: true, agent, clawHome: clawHome(dshHome) })
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
        const result = updateAgentPolicy(loaded, agentId, normalizePolicy(body && body.policy))
        if (!result.agent) {
          writeJson(res, 404, { ok: false, error: 'agent not found' })
          return
        }
        await saveRegistry(file, result.registry)
        if (result.agent.canonicalRoot && String(result.agent.canonicalRoot).indexOf('DSclaw') >= 0) {
          try {
            await writeFile(join(result.agent.canonicalRoot, 'policy.json'), JSON.stringify(result.agent.policy, null, 2) + '\n')
          } catch { /* directory missing */ }
        }
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
        await saveRegistry(file, result.registry)
        if (result.agent.canonicalRoot && String(result.agent.canonicalRoot).indexOf('DSclaw') >= 0) {
          try {
            await writeFile(join(result.agent.canonicalRoot, 'policy.json'), JSON.stringify(result.agent.policy, null, 2) + '\n')
          } catch { /* directory missing */ }
        }
        writeJson(res, 200, { ok: true, agent: result.agent })
      }),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: '/dsh-agent-registry/models',
      handler: handle(async (_req, res) => {
        const official = normalizeModel(_internal.readOfficialSelection())
          || normalizeModel(optionalService(ctx, 'agentDefaultModel') && optionalService(ctx, 'agentDefaultModel').currentSelection())
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
