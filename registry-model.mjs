export function normalizeModel(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const provider = typeof raw.provider === 'string' ? raw.provider.trim() : ''
  const model = typeof raw.model === 'string' ? raw.model.trim() : ''
  if (!provider || !model) return null
  const effort = typeof raw.reasoningEffort === 'string' ? raw.reasoningEffort.trim() : ''
  return effort ? { provider, model, reasoningEffort: effort } : { provider, model }
}

export function modelKey(selection) {
  const next = normalizeModel(selection)
  return next ? next.provider + '::' + next.model : 'inherit'
}

export function hasLoggedModel(agent) {
  const session = agent && agent.session
  if (!session || typeof session.requestHeader !== 'function') return false
  try {
    const header = session.requestHeader()
    const config = header && header.config
    return !!(config && config.provider && config.model)
  } catch {
    return false
  }
}

export function findClawAgent(registry, query) {
  const rows = registry && registry.agents ? Object.values(registry.agents) : []
  const cwd = query && query.cwd ? String(query.cwd) : ''
  const preset = query && query.preset ? String(query.preset) : ''
  for (const row of rows) {
    if (!row || row.status === 'archived') continue
    if (cwd && row.canonicalRoot === cwd) return row
  }
  if (preset) {
    for (const row of rows) {
      if (!row || row.status === 'archived') continue
      if (row.dshPreset === preset) return row
    }
  }
  return null
}

export function modelOfAgent(registry, agent) {
  if (!agent || !agent.session) return null
  const header = agent.session.header || {}
  const row = findClawAgent(registry, {
    cwd: header.cwd,
    preset: header.agentPreset,
  })
  return row ? normalizeModel(row.model) : null
}

export function resolveBlankSelection(agent, official, clawModel) {
  if (!clawModel) return official
  if (hasLoggedModel(agent)) return official
  return clawModel
}

export async function listModelCatalog(llm) {
  const groups = []
  if (!llm || typeof llm.listProviders !== 'function') return groups
  const providers = llm.listProviders() || []
  for (const provider of providers) {
    if (!provider || !provider.id) continue
    let models = []
    try {
      models = typeof llm.listModels === 'function' ? await llm.listModels(provider.id) : []
    } catch {
      models = []
    }
    const entries = []
    for (const item of Array.isArray(models) ? models : []) {
      if (!item || !item.id) continue
      let resolved = item
      if (typeof llm.resolveModelInfo === 'function') {
        try {
          resolved = await llm.resolveModelInfo(provider.id, item.id)
        } catch {
          resolved = item
        }
      }
      const reasoning = resolved && resolved.reasoning
      entries.push({
        id: item.id,
        name: item.name || item.id,
        description: item.description || '',
        reasoning: reasoning && Array.isArray(reasoning.efforts)
          ? {
            efforts: reasoning.efforts.map((effort) => ({
              id: effort.id,
              name: effort.name || effort.id,
              description: effort.description || '',
            })).filter((effort) => effort.id),
            defaultEffort: reasoning.defaultEffort || '',
          }
          : null,
      })
    }
    groups.push({
      id: provider.id,
      name: provider.name || provider.id,
      models: entries,
    })
  }
  return groups
}

export function findCatalogModel(groups, provider, model) {
  for (const group of groups || []) {
    if (group.id !== provider) continue
    for (const item of group.models || []) {
      if (item.id === model) return { group, model: item }
    }
  }
  return null
}

export function effortLabel(reasoning, effortId, fallback) {
  if (!reasoning) return fallback || ''
  const id = effortId || reasoning.defaultEffort
  if (!id) return fallback || ''
  const hit = (reasoning.efforts || []).find((row) => row.id === id)
  return hit ? hit.name : id
}
