// Declared capability ceilings for preset templates. Phase 0 does not enforce.

import {
  AGENT_PRESET_IDS,
  INIT_PRESET,
  POLICY_SCHEMA_VERSION,
  PRESET_IDS,
  TOOL_IDS,
  applyPreset,
  clampClawPolicy,
  clawHardCap,
  declaredOf,
  intersectPolicies,
  isPresetId,
  isToolEnabled,
  normalizePolicy,
  optionAllowed,
  toggleTool,
} from '../dsh-agent-policy/policy-schema.mjs'

export {
  AGENT_PRESET_IDS,
  INIT_PRESET,
  POLICY_SCHEMA_VERSION,
  PRESET_IDS,
  TOOL_IDS,
  applyPreset,
  clampClawPolicy,
  clawHardCap,
  declaredOf,
  intersectPolicies,
  isPresetId,
  isToolEnabled,
  normalizePolicy,
  optionAllowed,
  toggleTool,
}

export const SHIPPED_PRESET_IDS = ['standard', 'code', 'minimal', 'cordis']
export const TEMPLATE_ID = 'wa-template'
export const TEMPLATE_NAME = 'claw区agent模板'
export const TEMPLATE_LEGACY_NAMES = ['工作区 Agent 模板', '工作区agent模板']
export const TEMPLATE_SOURCE_CANDIDATES = ['standard', 'code']

export function presetIdForWorkspace(workspaceId) {
  return 'wa-' + String(workspaceId)
}

export function isShippedPreset(id) {
  return SHIPPED_PRESET_IDS.includes(id)
}

export function isClawPresetId(id) {
  if (typeof id !== 'string' || id === '') return false
  if (id === TEMPLATE_ID) return true
  if (isShippedPreset(id)) return false
  return id.startsWith('wa-')
}

export function fallbackMissingPreset(id, liveIds, defaultId = 'standard') {
  if (id == null || id === '') return id
  const live = liveIds instanceof Set ? liveIds : new Set(liveIds || [])
  if (live.has(id)) return id
  if (isClawPresetId(id)) return defaultId || 'standard'
  return id
}

export function rewriteTemplatePresetYaml(text, name) {
  const line = 'name: ' + name
  if (typeof text !== 'string' || text === '') return line + '\n'
  if (/^name:\s*.+$/m.test(text)) return text.replace(/^name:\s*.+$/m, line)
  return line + '\n' + text
}

export async function ensureTemplateNamed(presets, io) {
  const list = await presets.list()
  const template = list.find((row) => row && row.id === TEMPLATE_ID)
  if (template == null) return { changed: false }
  if (template.name === TEMPLATE_NAME) return { changed: false }
  if (template.path == null || io == null || typeof io.readFile !== 'function') {
    return { changed: false }
  }
  const file = String(template.path).replace(/[/\\][^/\\]+$/, '') + '/preset.yml'
  const text = await io.readFile(file, 'utf8')
  const next = rewriteTemplatePresetYaml(text, TEMPLATE_NAME)
  if (next === text) return { changed: false }
  await io.writeFile(file, next)
  return { changed: true, file }
}

export function openPersonaYaml(text) {
  if (typeof text !== 'string' || text === '') return text
  return text.replace(/^(\s*)complete:\s*true\s*$/m, '$1complete: false')
}

export async function ensureOpenPersona(presets, io) {
  if (presets == null || typeof presets.list !== 'function' || io == null) return { changed: 0 }
  const list = await presets.list()
  let changed = 0
  for (const row of list) {
    if (!row || !isClawPresetId(row.id) || !row.path) continue
    try {
      const text = await io.readFile(row.path, 'utf8')
      const next = openPersonaYaml(text)
      if (next !== text) {
        await io.writeFile(row.path, next)
        changed += 1
      }
    } catch { /* missing composition */ }
  }
  return { changed }
}

export async function clearClawDefault(settings, defaultId) {
  if (!isClawPresetId(defaultId)) return { cleared: false }
  if (settings == null || typeof settings.mutate !== 'function') {
    return { cleared: false, skipped: true }
  }
  await settings.mutate('agent-presets', [{ op: 'unset', path: ['default'] }])
  return { cleared: true }
}

export function isIsolatedMinimalClone(text) {
  const src = String(text || '')
  return src.includes('dsh-tool-bash-persistent') || src.includes('dsh-tool-str-replace-editor')
}

export async function mountWithClawFallback(origMount, id, agentCtx, fallbackId) {
  const fallback = fallbackId || 'standard'
  try {
    return await origMount(agentCtx, id)
  } catch (error) {
    if (id === fallback || !isClawPresetId(id)) throw error
    return origMount(agentCtx, fallback)
  }
}

export async function repairIsolatedMinimalClones(presets, io) {
  if (presets == null || typeof presets.list !== 'function' || typeof presets.copy !== 'function' || io == null) {
    return { repaired: [] }
  }
  const list = await presets.list()
  const ids = new Set(list.map((row) => row && row.id).filter(Boolean))
  const source = TEMPLATE_SOURCE_CANDIDATES.find((id) => ids.has(id))
  if (!source) return { repaired: [] }
  const repaired = []
  const rows = list.filter((row) => row && isClawPresetId(row.id) && row.path)
  rows.sort((a, b) => (a.id === TEMPLATE_ID ? -1 : b.id === TEMPLATE_ID ? 1 : 0))
  for (const row of rows) {
    let text = ''
    try {
      text = await io.readFile(row.path, 'utf8')
    } catch {
      continue
    }
    if (!isIsolatedMinimalClone(text)) continue
    const from = row.id === TEMPLATE_ID ? source : (ids.has(TEMPLATE_ID) ? TEMPLATE_ID : source)
    if (typeof presets.remove === 'function') {
      await presets.remove(row.id)
      ids.delete(row.id)
    }
    await presets.copy(from, row.id, row.name || row.id)
    ids.add(row.id)
    repaired.push(row.id)
  }
  return { repaired }
}

export async function ensureGeneratedPreset(presets, spec) {
  const id = spec.id
  const name = spec.name
  if (isShippedPreset(id) || id === TEMPLATE_ID) {
    throw new Error('refusing to overwrite a shipped or template preset')
  }
  const list = await presets.list()
  const ids = new Set(list.map((row) => row.id))
  if (!ids.has(TEMPLATE_ID)) {
    const source = TEMPLATE_SOURCE_CANDIDATES.find((candidate) => ids.has(candidate))
    if (!source) throw new Error('no official preset to copy as template')
    await presets.copy(source, TEMPLATE_ID, TEMPLATE_NAME)
    ids.add(TEMPLATE_ID)
  }
  if (!ids.has(id)) {
    await presets.copy(TEMPLATE_ID, id, name || id)
  }
  return id
}
