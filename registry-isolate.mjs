import { isClawPresetId, isClawWorkspaceFact, isDsClawPath } from './registry-view.mjs'

export function shouldShowClawRoster() {
  return false
}

export function isOfficialWorkspaceItem(item, keys) {
  if (item == null) return false
  if (isDsClawPath(item.path || item.cwd || '')) return false
  if (keys && isClawWorkspaceFact(item, keys)) return false
  return true
}

export function clawSessionIdsFromWorkspaces(items, keys) {
  const ids = new Set()
  const list = Array.isArray(items) ? items : []
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    if (isOfficialWorkspaceItem(item, keys)) continue
    const rows = item && item.sessionIds
    if (!Array.isArray(rows)) continue
    for (let s = 0; s < rows.length; s++) {
      if (rows[s]) ids.add(String(rows[s]))
    }
  }
  if (keys && keys.sessionIds) {
    for (const id of keys.sessionIds) ids.add(String(id))
  }
  return ids
}

export function isolateWorkspaceSnapshot(state, keys) {
  if (state == null || !Array.isArray(state.items)) return state
  const hidden = clawSessionIdsFromWorkspaces(state.items, keys)
  const items = state.items.filter((item) => isOfficialWorkspaceItem(item, keys))
  const archived = []
  const seen = new Set()
  const prev = Array.isArray(state.archivedSessionIds) ? state.archivedSessionIds : []
  for (let i = 0; i < prev.length; i++) {
    const id = String(prev[i] || '')
    if (!id || seen.has(id)) continue
    seen.add(id)
    archived.push(id)
  }
  for (const id of hidden) {
    if (seen.has(id)) continue
    seen.add(id)
    archived.push(id)
  }
  let recent = state.recentWorkspaceId
  if (recent && !items.some((item) => item && String(item.workspaceId) === String(recent))) {
    recent = items[0] && items[0].workspaceId
  }
  return { ...state, items, archivedSessionIds: archived, recentWorkspaceId: recent }
}

export function filterOfficialPresetRoster(response) {
  if (response == null || response.result == null || response.result.ok !== true) return response
  const value = response.result.value || {}
  const presets = Array.isArray(value.presets) ? value.presets : []
  const next = presets.filter((row) => row && !isClawPresetId(row.id))
  if (next.length === presets.length) return response
  return {
    ...response,
    result: {
      ...response.result,
      value: { ...value, presets: next },
    },
  }
}

export function wrapPresetList(api) {
  if (api == null || api.agentPresets == null || typeof api.agentPresets.list !== 'function') {
    return function () {}
  }
  const orig = api.agentPresets.list.bind(api.agentPresets)
  api.agentPresets.list = function list(payload) {
    return Promise.resolve(orig(payload)).then((response) => filterOfficialPresetRoster(response))
  }
  return function () {
    if (api.agentPresets.list !== orig) api.agentPresets.list = orig
  }
}

export function wrapWorkspaceList(list, keysOf) {
  if (list == null || typeof list.set !== 'function' || typeof list.getSnapshot !== 'function') {
    return function () {}
  }
  const origSet = list.set.bind(list)
  const origUpdate = typeof list.update === 'function' ? list.update.bind(list) : null
  function keys() {
    return typeof keysOf === 'function' ? keysOf() : keysOf
  }
  list.set = function set(next) {
    origSet(isolateWorkspaceSnapshot(next, keys()))
  }
  if (origUpdate) {
    list.update = function update(mutator) {
      origUpdate((draft) => {
        if (typeof mutator === 'function') mutator(draft)
        const isolated = isolateWorkspaceSnapshot(draft, keys())
        if (isolated === draft) return
        draft.items = isolated.items
        draft.archivedSessionIds = isolated.archivedSessionIds
        draft.recentWorkspaceId = isolated.recentWorkspaceId
      })
    }
  }
  origSet(isolateWorkspaceSnapshot(list.getSnapshot(), keys()))
  return function () {
    list.set = origSet
    if (origUpdate) list.update = origUpdate
  }
}

export function isOfficialSearchHit(item, keys) {
  if (item == null) return false
  const sessionId = item.sessionId || item.id
  if (sessionId && keys && keys.sessionIds && keys.sessionIds.has(String(sessionId))) return false
  if (isClawPresetId(item.agentPreset)) return false
  if (isDsClawPath(item.cwd || item.path || '')) return false
  return true
}

export function wrapSessionSearch(sessions, keysOf) {
  if (sessions == null || typeof sessions.search !== 'function') return function () {}
  const orig = sessions.search.bind(sessions)
  sessions.search = function search(query, signal) {
    return Promise.resolve(orig(query, signal)).then((result) => {
      if (!result || result.ok !== true || !result.value) return result
      const keys = typeof keysOf === 'function' ? keysOf() : keysOf
      const items = Array.isArray(result.value.items)
        ? result.value.items.filter((item) => isOfficialSearchHit(item, keys))
        : []
      return { ...result, value: { ...result.value, items } }
    })
  }
  return function () {
    if (sessions.search !== orig) sessions.search = orig
  }
}
