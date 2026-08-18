// Client-safe view helpers. No filesystem.

export const CLAW_TEMPLATE_ID = 'wa-template'
export const CLAW_TEMPLATE_NAMES = ['claw区agent模板', '工作区 Agent 模板', '工作区agent模板']

export function isClawPresetId(id) {
  if (typeof id !== 'string' || id === '') return false
  if (id === CLAW_TEMPLATE_ID) return true
  if (id === 'standard' || id === 'code' || id === 'minimal' || id === 'cordis') return false
  return id.startsWith('wa-')
}

export function clawAgents(projected) {
  return ((projected && projected.agents) || []).filter((agent) => (
    agent && agent.status !== 'archived' && agent.workspacePresent !== false
  ))
}

export function clawPresetIds(projected) {
  const ids = new Set([CLAW_TEMPLATE_ID])
  for (const agent of (projected && projected.agents) || []) {
    if (agent && agent.dshPreset) ids.add(agent.dshPreset)
  }
  return ids
}

export function clawHideNames(projected) {
  const names = new Set(CLAW_TEMPLATE_NAMES)
  for (const agent of (projected && projected.agents) || []) {
    if (agent && agent.title) names.add(String(agent.title))
    if (agent && agent.slug) names.add(String(agent.slug))
  }
  return names
}

export function isDsClawPath(path) {
  if (typeof path !== 'string' || path === '') return false
  return /(^|\/)DSclaw(\/|$)/.test(path.replace(/\\/g, '/'))
}

export function clawHideKeys(projected) {
  const titles = new Set()
  const slugs = new Set()
  const paths = new Set()
  const sessionIds = new Set()
  const workspaceIds = new Set()
  for (const agent of (projected && projected.agents) || []) {
    if (!agent) continue
    if (agent.title) titles.add(String(agent.title))
    if (agent.slug) slugs.add(String(agent.slug))
    if (agent.canonicalRoot) paths.add(String(agent.canonicalRoot))
    if (agent.workspaceId) workspaceIds.add(String(agent.workspaceId))
    const ids = agent.sessionIds || []
    for (let i = 0; i < ids.length; i++) sessionIds.add(String(ids[i]))
  }
  return { titles, slugs, paths, sessionIds, workspaceIds }
}

export function shouldHideOfficialGroup(title, clawTitlesOrKeys) {
  if (title == null || title === '') return false
  if (clawTitlesOrKeys instanceof Set) return clawTitlesOrKeys.has(title)
  const keys = clawTitlesOrKeys || {}
  if (keys.titles && keys.titles.has(title)) return true
  if (keys.slugs && keys.slugs.has(title)) return true
  return false
}

export function isClawWorkspaceFact(fact, keys) {
  if (fact == null || keys == null) return false
  if (fact.title && shouldHideOfficialGroup(fact.title, keys)) return true
  if (fact.workspaceId && keys.workspaceIds && keys.workspaceIds.has(String(fact.workspaceId))) return true
  if (fact.path && keys.paths && keys.paths.has(String(fact.path))) return true
  if (isDsClawPath(fact.path || fact.cwd || '')) return true
  if (fact.sessionId && keys.sessionIds && keys.sessionIds.has(String(fact.sessionId))) return true
  return false
}

function menuLabelStartsWithName(label, name) {
  if (!label || !name) return false
  if (label === name) return true
  if (label.indexOf(name + ' ·') === 0) return true
  if (label.indexOf(name) !== 0) return false
  const next = label.charAt(name.length)
  return next === ' ' || next === '·' || !/[A-Za-z0-9_-]/.test(next)
}

export function isClawPresetMenuLabel(text, names) {
  const raw = String(text || '')
  const label = raw.replace(/\s+/g, ' ').trim()
  if (!label) return false
  const firstLine = raw.split(/\r?\n/)[0].replace(/\s+/g, ' ').trim()
  for (const name of names || []) {
    if (!name) continue
    if (menuLabelStartsWithName(label, name) || menuLabelStartsWithName(firstLine, name)) return true
  }
  return false
}

export function selectableAgents(projected, labels) {
  const names = labels || {}
  const rows = []
  for (const agent of (projected && projected.agents) || []) {
    const title = agent.title || agent.canonicalRoot || agent.agentId
    const archived = agent.status === 'archived'
    rows.push({
      agentId: agent.agentId,
      kind: 'workspace',
      label: archived ? title + ' (' + (names.archived || 'archived') + ')' : title,
      agent,
    })
  }
  return rows
}

export function normalizeZone(value) {
  return value === 'claw' ? 'claw' : 'workspace'
}

export function defaultZone(hasClaw) {
  return hasClaw ? 'claw' : 'workspace'
}

export function resolveZone(zone) {
  return zone === 'claw' ? 'claw' : 'workspace'
}

export function readStoredZone() {
  try {
    const value = typeof localStorage !== 'undefined' ? localStorage.getItem('dar-sidebar-zone') : ''
    return value === 'claw' || value === 'workspace' ? value : ''
  } catch {
    return ''
  }
}

export function detectClawZone(doc) {
  if (doc && typeof doc.querySelector === 'function') {
    if (doc.querySelector('[data-dar-zone-switch] [data-zone="claw"][data-active="true"]')) return true
    if (doc.querySelector('[data-dar-zone-switch] [data-zone="workspace"][data-active="true"]')) return false
  }
  return readStoredZone() === 'claw'
}

export function agentForSession(projected, sessionId, session) {
  const agents = clawAgents(projected)
  if (sessionId) {
    for (let i = 0; i < agents.length; i++) {
      const ids = agents[i].sessionIds
      if (Array.isArray(ids) && ids.indexOf(sessionId) >= 0) return agents[i]
    }
  }
  const cwd = session && (session.cwd || session.path)
  if (cwd) {
    for (let i = 0; i < agents.length; i++) {
      if (agents[i].canonicalRoot && agents[i].canonicalRoot === cwd) return agents[i]
    }
  }
  return null
}

export function boundPresetOf(agent) {
  return agent && agent.dshPreset ? agent.dshPreset : ''
}

function startOfDay(ms) {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function sessionStamp(updatedAt, now, t) {
  const at = Number(updatedAt)
  if (!Number.isFinite(at) || at <= 0) return ''
  const d = new Date(at)
  const clock = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
  const day = startOfDay(now) - startOfDay(at)
  if (day === 0) return clock
  if (day === 86400000) return typeof t === 'function' ? t('timeYesterday') : '昨天'
  const m = d.getMonth() + 1
  const dayNum = d.getDate()
  if (d.getFullYear() === new Date(now).getFullYear()) {
    return typeof t === 'function' ? t('timeMonthDay', { m: m, d: dayNum }) : (m + '月' + dayNum + '日')
  }
  return typeof t === 'function'
    ? t('timeYearMonthDay', { y: d.getFullYear(), m: m, d: dayNum })
    : (d.getFullYear() + '年' + m + '月' + dayNum + '日')
}

export function isClawBoundSession(row, agent) {
  if (agent) return true
  return isDsClawPath(row && (row.cwd || row.path))
}

export function nextPresetBind() {
  return { action: 'idle', pending: null }
}

export function isOfficialSectionLabel(text) {
  const value = String(text || '').trim()
  return value === '工作区' || value === 'Workspaces' || value === '会话' || value === 'Sessions'
}

export function normalizeSearchQuery(value) {
  return String(value || '').trim().toLowerCase()
}

export function textMatchesQuery(text, query) {
  const q = normalizeSearchQuery(query)
  if (!q) return true
  return String(text || '').toLowerCase().indexOf(q) >= 0
}

export function filterClawSearch(agents, query, titleOf) {
  const list = Array.isArray(agents) ? agents : []
  const q = normalizeSearchQuery(query)
  if (!q) {
    return { query: '', agents: list.slice(), forcedOpen: new Set() }
  }
  const out = []
  const forcedOpen = new Set()
  for (let i = 0; i < list.length; i++) {
    const agent = list[i]
    if (!agent) continue
    const nameHit = textMatchesQuery(agent.title || agent.canonicalRoot || agent.agentId, q)
      || textMatchesQuery(agent.slug, q)
    const ids = Array.isArray(agent.sessionIds) ? agent.sessionIds : []
    const keep = []
    for (let s = 0; s < ids.length; s++) {
      const title = typeof titleOf === 'function' ? titleOf(ids[s]) : ''
      if (textMatchesQuery(title, q)) keep.push(ids[s])
    }
    if (!nameHit && keep.length === 0) continue
    const next = Object.assign({}, agent)
    next.sessionIds = nameHit ? ids.slice() : keep
    out.push(next)
    forcedOpen.add(agent.agentId)
  }
  return { query: q, agents: out, forcedOpen }
}
