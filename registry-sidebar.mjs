import {
  clawAgents,
  clawHideKeys,
  defaultZone,
  filterClawSearch,
  isClawWorkspaceFact,
  isOfficialSectionLabel,
  normalizeZone,
  sessionStamp,
} from './registry-view.mjs'

export const CLAW_ATTR = 'data-dar-claw-section'
export const HIDE_ATTR = 'data-dar-claw-hide'
export const TREE_HIDE_ATTR = 'data-dar-tree-hide'
export const ZONE_HIDE_ATTR = 'data-dar-zone-hide'
export const ZONE_ATTR = 'data-dar-zone-switch'
export const CLAW_ACTIONS_ATTR = 'data-dar-claw-actions'
export const SEARCH_HIDE_ATTR = 'data-dar-search-hide'

const ICON_CHEVRON = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M4.25 2.83v8.34c0 .49.59.74.94.39l4.17-4.17a.55.55 0 0 0 0-.78L5.19 2.44c-.35-.35-.94-.1-.94.39Z" fill="currentColor"/></svg>'
const ICON_PLUS = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'
const ICON_MORE = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.5" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="12.5" cy="8" r="1.2"/></svg>'
const ICON_EDIT = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M9.6 3.4 12.6 6.4 6 13H3v-3l6.6-6.6Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="m8.5 4.5 3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'
const ICON_ARCHIVE = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.8 4.2h10.4v2.2H2.8zM4 6.4V13h8V6.4M6.2 9h3.6" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg>'
const ICON_FORK = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5 3.5v5.2c0 1.3 1 2.3 2.3 2.3H11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="5" cy="3.2" r="1.4" stroke="currentColor" stroke-width="1.4"/><circle cx="11" cy="11" r="1.4" stroke="currentColor" stroke-width="1.4"/><circle cx="5" cy="12.8" r="1.4" stroke="currentColor" stroke-width="1.4"/></svg>'
const ICON_COPY = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5.5" y="5.5" width="7" height="8" rx="1.2" stroke="currentColor" stroke-width="1.4"/><path d="M4 10.5H3.7A1.2 1.2 0 0 1 2.5 9.3V3.7A1.2 1.2 0 0 1 3.7 2.5h5.6A1.2 1.2 0 0 1 10.5 3.7V4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'
const ICON_EXPORT = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2v8M5 5l3-3 3 3M3 10v3h10v-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const ICON_TRASH = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3.5 4.5h9M6 4.5V3h4v1.5M5 6.5v6h6v-6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'

const OPEN_KEY = 'dar-claw-open'
const ZONE_KEY = 'dar-sidebar-zone'

export function findSessionTree(doc) {
  const trees = findOfficialTrees(doc)
  return trees[0] || null
}

export function findOfficialTrees(doc) {
  const out = []
  const trees = doc.querySelectorAll('[role="tree"]')
  for (let i = 0; i < trees.length; i++) {
    if (trees[i].closest('[' + CLAW_ATTR + ']')) continue
    out.push(trees[i])
  }
  return out
}

function reactFiber(el) {
  if (el == null) return null
  for (const key in el) {
    if (key.indexOf('__reactFiber$') === 0 || key.indexOf('__reactInternalInstance$') === 0) return el[key]
  }
  return null
}

export function officialRowFact(el) {
  const fact = { title: '', workspaceId: '', path: '', cwd: '', sessionId: '' }
  if (el == null) return fact
  const titleEl = el.querySelector && el.querySelector('[class*="title"]')
  fact.title = ((titleEl && titleEl.textContent) || '').trim()
  const stamped = typeof el.getAttribute === 'function' ? el.getAttribute('data-session-id') : ''
  if (stamped) fact.sessionId = stamped
  let fiber = reactFiber(el)
  let hops = 0
  let seenGroup = false
  let seenNode = false
  while (fiber != null && hops < 80) {
    const props = fiber.memoizedProps || fiber.pendingProps
    if (props != null) {
      const group = props.group
      if (group != null && !seenGroup) {
        seenGroup = true
        if (group.label && !fact.title) fact.title = String(group.label)
        if (group.workspaceId != null && !fact.workspaceId) fact.workspaceId = String(group.workspaceId)
        if (group.cwd && !fact.cwd) fact.cwd = String(group.cwd)
        if (group.path && !fact.path) fact.path = String(group.path)
      }
      const node = props.node
      if (node != null && !seenNode) {
        seenNode = true
        if (node.id && !fact.sessionId) fact.sessionId = String(node.id)
        if (node.cwd && !fact.cwd) fact.cwd = String(node.cwd)
        if (node.workspaceId != null && !fact.workspaceId) fact.workspaceId = String(node.workspaceId)
      }
      if (!seenGroup) {
        if (props.workspaceId != null && !fact.workspaceId) fact.workspaceId = String(props.workspaceId)
        if (props.path && !fact.path) fact.path = String(props.path)
        if (props.cwd && !fact.cwd) fact.cwd = String(props.cwd)
      }
      if (props.sessionId && !fact.sessionId) fact.sessionId = String(props.sessionId)
    }
    if (seenGroup && (fact.sessionId || seenNode || hops > 12)) break
    fiber = fiber.return
    hops += 1
  }
  return fact
}

export function officialGroupTitle(section) {
  const row = section.querySelector(':scope > [role="treeitem"]')
  if (row == null) return ''
  const title = row.querySelector('[class*="title"]')
  return ((title && title.textContent) || '').trim()
}

function markHidden(el, hide) {
  if (el == null) return
  const current = el.getAttribute(HIDE_ATTR) === '1'
  if (hide && !current) el.setAttribute(HIDE_ATTR, '1')
  if (!hide && current) el.removeAttribute(HIDE_ATTR)
}

export function hideOfficialClawGroups(doc, titlesOrKeys) {
  const keys = titlesOrKeys instanceof Set
    ? { titles: titlesOrKeys, slugs: titlesOrKeys, paths: new Set(), sessionIds: new Set(), workspaceIds: new Set() }
    : (titlesOrKeys || clawHideKeys(null))
  const trees = findOfficialTrees(doc)
  let hidden = 0
  for (let t = 0; t < trees.length; t++) {
    const tree = trees[t]
    for (let i = 0; i < tree.children.length; i++) {
      const section = tree.children[i]
      const fact = officialRowFact(section)
      if (!fact.title) fact.title = officialGroupTitle(section)
      const hide = isClawWorkspaceFact(fact, keys)
      markHidden(section, hide)
      if (hide) hidden += 1
    }
    const rows = tree.querySelectorAll('[role="treeitem"]')
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (row.closest('[' + HIDE_ATTR + '="1"]')) continue
      const fact = officialRowFact(row)
      const hide = isClawWorkspaceFact(fact, keys)
      markHidden(row, hide)
      if (hide) hidden += 1
    }
  }
  return hidden
}

export function findOfficialSectionLabel(doc) {
  const spans = doc.querySelectorAll('span')
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i]
    if (span.closest('[' + ZONE_ATTR + ']')) continue
    if (span.closest('[' + CLAW_ATTR + ']')) continue
    if (!isOfficialSectionLabel(span.textContent)) continue
    const parent = span.parentElement
    if (parent == null) continue
    if (parent.querySelector('input, button, [class*="search"]')) return span
    if (parent.children.length >= 2) return span
  }
  return null
}

export function officialLabelIsHidden(label) {
  if (label == null) return true
  return String(label.className || '').indexOf('Hidden') >= 0
}

const VIEW_OPTION_LABELS = ['视图选项', 'View options']
const ADD_WORKSPACE_LABELS = ['添加工作区', 'Add workspace', '添加工作区…', 'Add workspace…']

function ariaOf(el) {
  if (!el || typeof el.getAttribute !== 'function') return ''
  return String(el.getAttribute('aria-label') || el.getAttribute('title') || '').trim()
}

function labelMatches(value, labels) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return false
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]
    if (text === label || text.indexOf(label) === 0) return true
  }
  return false
}

function inChrome(el) {
  return Boolean(el && typeof el.closest === 'function' && (
    el.closest('.dar-page') || el.closest('.dar-zone-btn') || el.closest('[role="dialog"]')
  ))
}

export function findHeaderActionButtons(doc) {
  const found = { view: null, add: null }
  if (doc == null || typeof doc.querySelectorAll !== 'function') return found
  const buttons = doc.querySelectorAll('button')
  for (let i = 0; i < buttons.length; i++) {
    const button = buttons[i]
    if (inChrome(button)) continue
    const aria = ariaOf(button)
    if (!found.view && labelMatches(aria, VIEW_OPTION_LABELS)) found.view = button
    if (!found.add && labelMatches(aria, ADD_WORKSPACE_LABELS)) found.add = button
  }
  return found
}

function namedAncestor(el, token) {
  let node = el
  for (let i = 0; i < 10 && node; i++) {
    const cls = String(node.className || '')
    if (cls.indexOf(token) >= 0) return node
    node = node.parentElement
  }
  return null
}

function looksLikeSearchCluster(el) {
  if (!el) return false
  const cls = String(el.className || '')
  if (cls.indexOf('search') >= 0 || cls.indexOf('Search') >= 0) return true
  if (typeof el.querySelector !== 'function') return false
  return Boolean(el.querySelector('input, [class*="search"], [class*="Search"]'))
}

function commonAncestor(left, right) {
  if (!left || !right) return left || right || null
  const seen = []
  let node = left
  for (let i = 0; i < 12 && node; i++) {
    seen.push(node)
    node = node.parentElement
  }
  node = right
  for (let i = 0; i < 12 && node; i++) {
    if (seen.indexOf(node) >= 0) return node
    node = node.parentElement
  }
  return left.parentElement || null
}

export function findHeaderActions(doc) {
  const found = findHeaderActionButtons(doc)
  const named = namedAncestor(found.view, 'headerActions') || namedAncestor(found.add, 'headerActions')
  if (named) return named
  if (found.view && found.add) {
    const shared = commonAncestor(found.view, found.add)
    if (shared && !looksLikeSearchCluster(shared)) return shared
  }
  const one = found.view || found.add
  if (!one) return null
  const parent = one.parentElement || null
  return parent && !looksLikeSearchCluster(parent) ? parent : null
}

function markClawAction(node, on) {
  if (!node || typeof node.setAttribute !== 'function') return
  if (on) node.setAttribute(CLAW_ACTIONS_ATTR, '1')
  else node.removeAttribute(CLAW_ACTIONS_ATTR)
}

function wrapperOf(button, cluster) {
  const parent = button && button.parentElement
  if (!parent || parent === cluster) return null
  if (looksLikeSearchCluster(parent)) return null
  return parent
}

export function applyClawHeaderActions(doc, zone) {
  const found = findHeaderActionButtons(doc)
  const actions = findHeaderActions(doc)
  const claw = zone === 'claw'
  markClawAction(actions, claw)
  if (actions && typeof actions.setAttribute === 'function') {
    if (claw) actions.setAttribute('aria-hidden', 'true')
    else actions.removeAttribute('aria-hidden')
  }
  const nodes = [found.view, found.add, wrapperOf(found.view, actions), wrapperOf(found.add, actions)]
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i] && nodes[i] !== actions) markClawAction(nodes[i], claw)
  }
  if (doc && doc.body && typeof doc.body.setAttribute === 'function') {
    doc.body.setAttribute('data-dar-zone', claw ? 'claw' : 'workspace')
  }
}

const SEARCH_PLACEHOLDERS = ['搜索会话…', 'Search sessions…', '搜索会话', 'Search sessions']
const SEARCH_BUTTON_LABELS = ['搜索会话', 'Search sessions']

export function findOfficialSearchInput(doc) {
  if (doc == null || typeof doc.querySelectorAll !== 'function') return null
  const inputs = doc.querySelectorAll('input')
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]
    if (inChrome(input)) continue
    if (input.classList && input.classList.contains('dar-claw-input')) continue
    const ph = String(input.getAttribute('placeholder') || '')
    if (SEARCH_PLACEHOLDERS.indexOf(ph) >= 0) return input
    if (input.getAttribute('data-dar-search-scope') === 'claw') return input
  }
  const buttons = doc.querySelectorAll('button')
  for (let i = 0; i < buttons.length; i++) {
    const button = buttons[i]
    if (inChrome(button)) continue
    const aria = ariaOf(button)
    if (SEARCH_BUTTON_LABELS.indexOf(aria) < 0) continue
    let node = button
    for (let d = 0; d < 5 && node; d++) {
      const found = node.querySelector && node.querySelector('input')
      if (found && !(found.classList && found.classList.contains('dar-claw-input'))) return found
      node = node.parentElement
    }
  }
  return null
}

export function readOfficialSearchQuery(doc) {
  const input = findOfficialSearchInput(doc)
  return input ? String(input.value || '').trim() : ''
}

export function applyOfficialSearchHide(doc, zone) {
  const hide = zone === 'claw'
  const trees = findOfficialTrees(doc)
  for (let t = 0; t < trees.length; t++) {
    const tree = trees[t]
    const list = tree.parentElement
    if (!list || !list.children) continue
    const kids = list.children
    for (let i = 0; i < kids.length; i++) {
      const kid = kids[i]
      if (kid === tree || kid.hasAttribute(CLAW_ATTR)) continue
      if (hide) kid.setAttribute(SEARCH_HIDE_ATTR, '1')
      else kid.removeAttribute(SEARCH_HIDE_ATTR)
    }
  }
}

export function applyClawSearchInput(doc, zone, placeholder) {
  const input = findOfficialSearchInput(doc)
  if (!input || typeof input.setAttribute !== 'function') return
  if (zone === 'claw') {
    if (!input.getAttribute('data-dar-search-ph')) {
      input.setAttribute('data-dar-search-ph', input.getAttribute('placeholder') || '')
    }
    if (placeholder) input.setAttribute('placeholder', placeholder)
    input.setAttribute('data-dar-search-scope', 'claw')
  } else {
    const prev = input.getAttribute('data-dar-search-ph')
    if (prev != null) {
      input.setAttribute('placeholder', prev)
      input.removeAttribute('data-dar-search-ph')
    }
    input.removeAttribute('data-dar-search-scope')
  }
}

export function applyZoneVisibility(doc, zone, titlesOrKeys) {
  const trees = findOfficialTrees(doc)
  for (let t = 0; t < trees.length; t++) {
    const tree = trees[t]
    if (tree.hasAttribute(TREE_HIDE_ATTR)) tree.removeAttribute(TREE_HIDE_ATTR)
    const kids = tree.children
    for (let i = 0; i < kids.length; i++) {
      const kid = kids[i]
      if (kid.hasAttribute(CLAW_ATTR)) {
        if (zone === 'claw') kid.removeAttribute(ZONE_HIDE_ATTR)
        else kid.setAttribute(ZONE_HIDE_ATTR, '1')
        continue
      }
      if (zone === 'claw') kid.setAttribute(TREE_HIDE_ATTR, '1')
      else kid.removeAttribute(TREE_HIDE_ATTR)
    }
  }
  if (zone !== 'claw') hideOfficialClawGroups(doc, titlesOrKeys)
  const claw = doc.querySelector('[' + CLAW_ATTR + ']')
  if (claw != null && claw.parentNode && claw.parentNode.getAttribute && claw.parentNode.getAttribute('role') !== 'tree') {
    const hide = zone !== 'claw'
    if (hide) claw.setAttribute(ZONE_HIDE_ATTR, '1')
    else claw.removeAttribute(ZONE_HIDE_ATTR)
  }
  const pins = doc.querySelectorAll('[data-dsa-pin-section]')
  for (let i = 0; i < pins.length; i++) {
    if (zone === 'claw') pins[i].setAttribute(ZONE_HIDE_ATTR, '1')
    else pins[i].removeAttribute(ZONE_HIDE_ATTR)
  }
  applyClawHeaderActions(doc, zone)
  applyOfficialSearchHide(doc, zone)
}

function readOpenMap() {
  try {
    const raw = localStorage.getItem(OPEN_KEY)
    const value = raw ? JSON.parse(raw) : {}
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

function writeOpenMap(map) {
  try { localStorage.setItem(OPEN_KEY, JSON.stringify(map)) } catch { /* ignore */ }
}

function sessionSnapshot(sessions) {
  if (sessions == null || sessions.list == null || typeof sessions.list.getSnapshot !== 'function') {
    return { byId: {}, current: '' }
  }
  const snap = sessions.list.getSnapshot() || {}
  return { byId: snap.byId || {}, current: snap.current || '' }
}

function titleForSession(row, id, t) {
  if (row == null) return id
  if (row.blank) return t('clawNewSession')
  return row.displayTitle || row.title || id
}

function closeClawMenu(doc) {
  const open = doc.querySelectorAll('[data-dar-menu]')
  for (let i = 0; i < open.length; i++) open[i].remove()
  const marked = doc.querySelectorAll('.dar-menu-open')
  for (let i = 0; i < marked.length; i++) marked[i].classList.remove('dar-menu-open')
}

function placeMenu(menu, anchor) {
  const rect = anchor.getBoundingClientRect()
  let left = rect.right - menu.offsetWidth
  let top = rect.bottom + 4
  const vw = window.innerWidth
  const vh = window.innerHeight
  left = Math.min(Math.max(left, 12), Math.max(12, vw - menu.offsetWidth - 12))
  if (top + menu.offsetHeight > vh - 12) top = Math.max(12, rect.top - menu.offsetHeight - 4)
  menu.style.left = left + 'px'
  menu.style.top = top + 'px'
}

function menuItem(doc, label, icon, onClick, danger) {
  const item = doc.createElement('button')
  item.type = 'button'
  item.setAttribute('role', 'menuitem')
  item.className = 'dar-menu-item' + (danger ? ' dar-danger' : '')
  const mark = doc.createElement('span')
  mark.className = 'dar-menu-icon'
  mark.innerHTML = icon
  const text = doc.createElement('span')
  text.textContent = label
  item.appendChild(mark)
  item.appendChild(text)
  item.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    onClick()
  })
  return item
}

function openMenu(doc, anchor, owner, items) {
  closeClawMenu(doc)
  const menu = doc.createElement('div')
  menu.className = 'dar-menu'
  menu.setAttribute('role', 'menu')
  menu.setAttribute('data-dar-menu', '1')
  for (let i = 0; i < items.length; i++) {
    const spec = items[i]
    if (spec.sep) {
      const sep = doc.createElement('div')
      sep.className = 'dar-menu-sep'
      sep.setAttribute('role', 'separator')
      menu.appendChild(sep)
      continue
    }
    menu.appendChild(menuItem(doc, spec.label, spec.icon, () => {
      closeClawMenu(doc)
      spec.onClick()
    }, spec.danger))
  }
  doc.body.appendChild(menu)
  placeMenu(menu, anchor)
  if (owner) owner.classList.add('dar-menu-open')
  const onDoc = (event) => {
    if (menu.contains(event.target) || (anchor.contains && anchor.contains(event.target))) return
    closeClawMenu(doc)
    doc.removeEventListener('pointerdown', onDoc, true)
  }
  doc.addEventListener('pointerdown', onDoc, true)
}

function promptText(doc, api, title, value, onSave) {
  const overlay = doc.createElement('div')
  overlay.className = 'dar-overlay'
  const box = doc.createElement('div')
  box.className = 'dar-dialog'
  const head = doc.createElement('div')
  head.className = 'dar-dialog-head'
  head.textContent = title
  const body = doc.createElement('div')
  body.className = 'dar-dialog-body'
  const input = doc.createElement('input')
  input.className = 'dar-input'
  input.value = value || ''
  body.appendChild(input)
  const foot = doc.createElement('div')
  foot.className = 'dar-dialog-actions'
  const cancel = doc.createElement('button')
  cancel.type = 'button'
  cancel.className = 'dar-btn'
  cancel.textContent = api.t('cancel')
  const save = doc.createElement('button')
  save.type = 'button'
  save.className = 'dar-btn'
  save.textContent = api.t('renameSave')
  function finish(ok) {
    overlay.remove()
    if (ok) onSave(String(input.value || '').trim())
  }
  cancel.addEventListener('click', () => finish(false))
  save.addEventListener('click', () => finish(true))
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') finish(true)
    if (event.key === 'Escape') finish(false)
  })
  overlay.addEventListener('click', (event) => { if (event.target === overlay) finish(false) })
  foot.appendChild(cancel)
  foot.appendChild(save)
  box.appendChild(head)
  box.appendChild(body)
  box.appendChild(foot)
  overlay.appendChild(box)
  doc.body.appendChild(overlay)
  input.focus()
  input.select()
}

export function createSidebar(doc, api) {
  const openMap = readOpenMap()
  let storedZone = ''
  try { storedZone = localStorage.getItem(ZONE_KEY) || '' } catch { storedZone = '' }
  let zone = storedZone === 'claw' || storedZone === 'workspace' ? storedZone : ''

  function hideKeys(projected) {
    return clawHideKeys(projected)
  }

  function currentZone() {
    return normalizeZone(zone)
  }

  function setZone(next) {
    zone = normalizeZone(next)
    try { localStorage.setItem(ZONE_KEY, zone) } catch { /* ignore */ }
    render()
    if (typeof api.onZone === 'function') api.onZone(zone)
  }

  function isOpen(agentId) {
    return openMap[agentId] !== false
  }

  function setOpen(agentId, next) {
    openMap[agentId] = next === true
    writeOpenMap(openMap)
  }

  const timeTick = setInterval(function () {
    if (currentZone() === 'claw') render()
  }, 60000)

  function host() {
    const tree = findSessionTree(doc)
    if (tree == null || tree.parentNode == null) return null
    return { parent: tree.parentNode, tree }
  }

  function removeSection() {
    const existing = doc.querySelector('[' + CLAW_ATTR + ']')
    if (existing != null) existing.remove()
  }

  function removeSwitch() {
    const existing = doc.querySelector('[' + ZONE_ATTR + ']')
    if (existing != null) existing.remove()
  }

  function renderSwitch(projected) {
    const label = findOfficialSectionLabel(doc)
    if (label == null) {
      removeSwitch()
      return
    }
    if (label.getAttribute('data-dar-label-hide') !== '1') {
      label.setAttribute('data-dar-label-hide', '1')
      label.setAttribute(HIDE_ATTR, '1')
    }
    let bar = doc.querySelector('[' + ZONE_ATTR + ']')
    if (bar == null) {
      bar = doc.createElement('div')
      bar.setAttribute(ZONE_ATTR, '')
      bar.setAttribute('role', 'tablist')
      const workspaceBtn = doc.createElement('button')
      workspaceBtn.type = 'button'
      workspaceBtn.className = 'dar-zone-btn'
      workspaceBtn.setAttribute('data-zone', 'workspace')
      workspaceBtn.setAttribute('role', 'tab')
      workspaceBtn.addEventListener('pointerdown', (event) => {
        event.preventDefault()
        event.stopPropagation()
        setZone('workspace')
      }, true)
      const clawBtn = doc.createElement('button')
      clawBtn.type = 'button'
      clawBtn.className = 'dar-zone-btn'
      clawBtn.setAttribute('data-zone', 'claw')
      clawBtn.setAttribute('role', 'tab')
      clawBtn.addEventListener('pointerdown', (event) => {
        event.preventDefault()
        event.stopPropagation()
        setZone('claw')
      }, true)
      bar.appendChild(workspaceBtn)
      bar.appendChild(clawBtn)
    }
    if (bar.parentNode !== label.parentNode || bar.nextSibling !== label) {
      label.parentNode.insertBefore(bar, label)
    }
    bar.setAttribute('aria-label', api.t('zoneSwitch'))
    bar.setAttribute('data-hidden', officialLabelIsHidden(label) ? '1' : '0')
    const active = currentZone()
    const workspaceBtn = bar.querySelector('[data-zone="workspace"]')
    const clawBtn = bar.querySelector('[data-zone="claw"]')
    if (workspaceBtn != null) {
      workspaceBtn.textContent = api.t('workspaceSection')
      workspaceBtn.setAttribute('data-active', active === 'workspace' ? 'true' : 'false')
      workspaceBtn.setAttribute('aria-selected', active === 'workspace' ? 'true' : 'false')
    }
    if (clawBtn != null) {
      clawBtn.textContent = api.t('clawSection')
      clawBtn.setAttribute('data-active', active === 'claw' ? 'true' : 'false')
      clawBtn.setAttribute('aria-selected', active === 'claw' ? 'true' : 'false')
    }
  }

  function onSearchInput(event) {
    const el = event && event.target
    if (!el || String(el.tagName || '').toLowerCase() !== 'input') return
    if (el.classList && el.classList.contains('dar-claw-input')) return
    if (currentZone() !== 'claw') return
    const official = findOfficialSearchInput(doc)
    if (official && el !== official) return
    if (!official) return
    render()
  }

  if (doc && typeof doc.addEventListener === 'function') {
    doc.addEventListener('input', onSearchInput, true)
  }

  function render() {
    const projected = api.getProjected()
    const allAgents = clawAgents(projected)
    if (zone !== 'workspace' && zone !== 'claw') {
      zone = defaultZone(allAgents.length > 0)
    }
    renderSwitch(projected)
    applyZoneVisibility(doc, currentZone(), hideKeys(projected))
    applyClawSearchInput(doc, currentZone(), api.t('searchPlaceholder'))
    const seat = host()
    if (seat == null) {
      if (currentZone() !== 'claw') removeSection()
      return
    }
    if (currentZone() !== 'claw') {
      removeSection()
      return
    }
    const snap = sessionSnapshot(api.clientSessions())
    const query = readOfficialSearchQuery(doc)
    const filtered = filterClawSearch(allAgents, query, (id) => titleForSession(snap.byId[id], id, api.t))
    const agents = filtered.agents
    const searching = filtered.query !== ''
    let section = doc.querySelector('[' + CLAW_ATTR + ']')
    if (section == null) {
      section = doc.createElement('div')
      section.setAttribute(CLAW_ATTR, '')
      section.className = 'dar-claw'
    }
    if (section.parentNode !== seat.tree) seat.tree.appendChild(section)
    const current = snap.current
    let head = section.querySelector('.dar-claw-head')
    if (head == null) {
      head = doc.createElement('div')
      head.className = 'dar-claw-head'
      section.appendChild(head)
    }
    if (head.textContent !== api.t('clawSection')) head.textContent = api.t('clawSection')
    let empty = section.querySelector('.dar-claw-empty')
    if (agents.length === 0) {
      if (empty == null) {
        empty = doc.createElement('p')
        empty.className = 'dar-claw-empty'
        section.appendChild(empty)
      }
      empty.textContent = searching ? api.t('searchNoMatch') : api.t('clawEmpty')
    } else if (empty != null) {
      empty.remove()
    }
    let create = section.querySelector('.dar-claw-create')
    if (create == null) {
      create = doc.createElement('div')
      create.className = 'dar-claw-create'
      const input = doc.createElement('input')
      input.type = 'text'
      input.className = 'dar-claw-input'
      input.setAttribute('maxlength', '40')
      const button = doc.createElement('button')
      button.type = 'button'
      button.className = 'dar-claw-create-btn'
      button.addEventListener('click', () => {
        const name = String(input.value || '').trim()
        if (!name || typeof api.createAgent !== 'function') return
        button.disabled = true
        Promise.resolve(api.createAgent(name)).then(() => {
          input.value = ''
        }).finally(() => { button.disabled = false })
      })
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') button.click()
      })
      create.appendChild(input)
      create.appendChild(button)
      section.appendChild(create)
    }
    const input = create.querySelector('.dar-claw-input')
    const button = create.querySelector('.dar-claw-create-btn')
    if (input != null) input.placeholder = api.t('createPlaceholder')
    if (button != null) button.textContent = api.t('createAgent')
    create.hidden = searching
    const hint = section.querySelector('.dar-claw-hint')
    if (hint != null) hint.remove()
    section.style.marginLeft = ''
    section.style.width = ''
    let list = section.querySelector('.dar-claw-list')
    if (list == null) {
      list = doc.createElement('div')
      list.className = 'dar-claw-list'
      section.appendChild(list)
    }
    const seen = new Set()
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i]
      seen.add(agent.agentId)
      let group = list.querySelector('[data-dar-agent="' + agent.agentId + '"]')
      if (group != null && group.querySelector('.dar-claw-mark') == null) {
        group.remove()
        group = null
      }
      if (group == null) {
        group = doc.createElement('div')
        group.className = 'dar-claw-group'
        group.setAttribute('data-dar-agent', agent.agentId)
        group.setAttribute('data-workspace-id', agent.workspaceId || '')
        const row = doc.createElement('div')
        row.className = 'dar-claw-row'
        row.setAttribute('role', 'button')
        const markSlot = doc.createElement('span')
        markSlot.className = 'dar-claw-slot dar-claw-mark-slot'
        const mark = doc.createElement('span')
        mark.className = 'dar-claw-mark'
        markSlot.appendChild(mark)
        const chevron = doc.createElement('span')
        chevron.className = 'dar-claw-slot dar-claw-chevron'
        chevron.innerHTML = ICON_CHEVRON
        const title = doc.createElement('span')
        title.className = 'dar-claw-title'
        const actions = doc.createElement('span')
        actions.className = 'dar-claw-actions'
        const more = doc.createElement('button')
        more.type = 'button'
        more.className = 'dar-claw-icon-btn dar-claw-more'
        more.innerHTML = ICON_MORE
        const add = doc.createElement('button')
        add.type = 'button'
        add.className = 'dar-claw-icon-btn dar-claw-add'
        add.innerHTML = ICON_PLUS
        actions.appendChild(more)
        actions.appendChild(add)
        row.appendChild(markSlot)
        row.appendChild(chevron)
        row.appendChild(title)
        row.appendChild(actions)
        const sessions = doc.createElement('div')
        sessions.className = 'dar-claw-sessions'
        group.appendChild(row)
        group.appendChild(sessions)
        row.addEventListener('pointerenter', () => { row.classList.add('dar-claw-hot') })
        row.addEventListener('pointerleave', () => { row.classList.remove('dar-claw-hot') })
        row.addEventListener('pointerdown', (event) => {
          if (event.target.closest && event.target.closest('.dar-claw-icon-btn')) return
          event.preventDefault()
        })
        row.addEventListener('click', (event) => {
          if (event.target.closest && event.target.closest('.dar-claw-icon-btn')) return
          event.preventDefault()
          const id = group.getAttribute('data-dar-agent')
          setOpen(id, !isOpen(id))
          render()
          const sel = window.getSelection && window.getSelection()
          if (sel && typeof sel.removeAllRanges === 'function') sel.removeAllRanges()
        })
        add.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          api.startSession(group.getAttribute('data-workspace-id'))
        })
        more.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          const id = group.getAttribute('data-dar-agent')
          const name = (group.querySelector('.dar-claw-title') && group.querySelector('.dar-claw-title').textContent) || id
          openMenu(doc, more, row, [
            {
              label: api.t('rename'),
              icon: ICON_EDIT,
              onClick() {
                promptText(doc, api, api.t('renameAgentTitle'), name, (next) => {
                  if (!next || next === name || typeof api.renameAgent !== 'function') return
                  Promise.resolve(api.renameAgent(id, next)).then(() => render())
                })
              },
            },
            {
              label: api.t('archive'),
              icon: ICON_ARCHIVE,
              onClick() {
                if (!id || typeof api.archiveAgent !== 'function') return
                if (!window.confirm(api.t('archiveBody'))) return
                Promise.resolve(api.archiveAgent(id)).then(() => render())
              },
            },
          ])
        })
        list.appendChild(group)
      }
      const title = group.querySelector('.dar-claw-title')
      const label = agent.title || agent.canonicalRoot || agent.agentId
      if (title != null && title.textContent !== label) title.textContent = label
      const row = group.querySelector('.dar-claw-row')
      if (row != null) {
        row.setAttribute('aria-expanded', isOpen(agent.agentId) ? 'true' : 'false')
        row.setAttribute('aria-label', api.t('clawToggle', { name: label }))
      }
      const add = group.querySelector('.dar-claw-add')
      if (add != null) add.setAttribute('aria-label', api.t('clawAddSession', { name: label }))
      const moreBtn = group.querySelector('.dar-claw-more')
      if (moreBtn != null) moreBtn.setAttribute('aria-label', api.t('moreAgent', { name: label }))
      if (searching || isOpen(agent.agentId)) group.classList.remove('dar-claw-collapsed')
      else group.classList.add('dar-claw-collapsed')
      const box = group.querySelector('.dar-claw-sessions')
      const ids = Array.isArray(agent.sessionIds) ? agent.sessionIds : []
      const keep = new Set(ids)
      for (let s = 0; s < ids.length; s++) {
        const id = ids[s]
        let item = box.querySelector('[data-session-id="' + id + '"]')
        if (item != null && (item.querySelector('.dar-claw-more') == null || item.querySelector('.dar-claw-slot') == null || item.querySelector('.dar-claw-session-time') == null)) {
          item.remove()
          item = null
        }
        if (item == null) {
          item = doc.createElement('div')
          item.className = 'dar-claw-session'
          item.setAttribute('role', 'button')
          item.setAttribute('data-session-id', id)
          const lead = doc.createElement('span')
          lead.className = 'dar-claw-slot'
          const text = doc.createElement('span')
          text.className = 'dar-claw-session-title'
          const time = doc.createElement('span')
          time.className = 'dar-claw-session-time'
          const actions = doc.createElement('span')
          actions.className = 'dar-claw-actions'
          const more = doc.createElement('button')
          more.type = 'button'
          more.className = 'dar-claw-icon-btn dar-claw-more'
          more.innerHTML = ICON_MORE
          actions.appendChild(more)
          item.appendChild(lead)
          item.appendChild(text)
          item.appendChild(time)
          item.appendChild(actions)
          item.addEventListener('click', (event) => {
            if (event.target.closest && event.target.closest('.dar-claw-icon-btn')) return
            api.openSession(id)
          })
          more.addEventListener('click', (event) => {
            event.preventDefault()
            event.stopPropagation()
            const sessionId = item.getAttribute('data-session-id')
            const name = (item.querySelector('.dar-claw-session-title') && item.querySelector('.dar-claw-session-title').textContent) || sessionId
            openMenu(doc, more, item, [
              {
                label: api.t('rename'),
                icon: ICON_EDIT,
                onClick() {
                  promptText(doc, api, api.t('renameSessionTitle'), name, (next) => {
                    if (!next || typeof api.renameSession !== 'function') return
                    Promise.resolve(api.renameSession(sessionId, next)).then(() => render())
                  })
                },
              },
              {
                label: api.t('forkSession'),
                icon: ICON_FORK,
                onClick() { if (typeof api.forkSession === 'function') api.forkSession(sessionId) },
              },
              {
                label: api.t('archiveSession'),
                icon: ICON_ARCHIVE,
                onClick() {
                  if (typeof api.archiveSession === 'function') Promise.resolve(api.archiveSession(sessionId)).then(() => render())
                },
              },
              { sep: true },
              {
                label: api.t('copySessionId'),
                icon: ICON_COPY,
                onClick() { if (typeof api.copySessionId === 'function') api.copySessionId(sessionId) },
              },
              {
                label: api.t('exportMd'),
                icon: ICON_EXPORT,
                onClick() { if (typeof api.exportSession === 'function') api.exportSession(sessionId) },
              },
              {
                label: api.t('deleteSession'),
                icon: ICON_TRASH,
                danger: true,
                onClick() {
                  if (!window.confirm(api.t('deleteBody'))) return
                  if (typeof api.deleteSession === 'function') Promise.resolve(api.deleteSession(sessionId)).then(() => render())
                },
              },
            ])
          })
          box.appendChild(item)
        }
        const text = item.querySelector('.dar-claw-session-title')
        const nextTitle = titleForSession(snap.byId[id], id, api.t)
        if (text != null && text.textContent !== nextTitle) text.textContent = nextTitle
        const time = item.querySelector('.dar-claw-session-time')
        const row = snap.byId[id]
        const stamp = row && !row.blank ? sessionStamp(row.updatedAt, Date.now(), api.t) : ''
        if (time != null && time.textContent !== stamp) time.textContent = stamp
        if (time != null) time.hidden = !stamp
        if (id === current) item.setAttribute('aria-current', 'true')
        else item.removeAttribute('aria-current')
        const sessionMore = item.querySelector('.dar-claw-more')
        if (sessionMore != null) sessionMore.setAttribute('aria-label', api.t('moreSession', { name: nextTitle }))
      }
      const stale = box.querySelectorAll('[data-session-id]')
      for (let s = 0; s < stale.length; s++) {
        if (!keep.has(stale[s].getAttribute('data-session-id'))) stale[s].remove()
      }
    }
    const leftovers = list.querySelectorAll('[data-dar-agent]')
    for (let i = 0; i < leftovers.length; i++) {
      if (!seen.has(leftovers[i].getAttribute('data-dar-agent'))) leftovers[i].remove()
    }
  }

  return {
    render,
    remove() {
      clearInterval(timeTick)
      if (doc && typeof doc.removeEventListener === 'function') {
        doc.removeEventListener('input', onSearchInput, true)
      }
      applyClawSearchInput(doc, 'workspace', '')
      applyOfficialSearchHide(doc, 'workspace')
      removeSection()
      removeSwitch()
      const label = findOfficialSectionLabel(doc)
      if (label != null) {
        label.removeAttribute(HIDE_ATTR)
        label.removeAttribute('data-dar-label-hide')
      }
      const tree = findSessionTree(doc)
      if (tree != null) tree.removeAttribute(TREE_HIDE_ATTR)
    },
    hideOfficialClawGroups,
    getZone() { return zone },
    setZone,
  }
}
