import { isClawPresetId, isClawPresetMenuLabel } from './registry-view.mjs'

export const SEAT_HIDE_ATTR = 'data-dar-seat-hide'
export const ACCESS_HIDE_ATTR = 'data-dar-access-hide'
export const WORKSPACE_HIDE_ATTR = 'data-dar-workspace-hide'
export const CLAW_SESSION_ATTR = 'data-dar-claw-session'

const ACCESS_CHIP_LABELS = [
  'Full access', 'Read Only', 'Workspace Write',
  'read-only', 'workspace-write', 'danger-full-access',
]

export function inProtectedChrome(el) {
  if (el == null || typeof el.closest !== 'function') return false
  return Boolean(
    el.closest('.dar-page')
    || el.closest('.dsp-page')
    || el.closest('.dar-zone-btn')
    || el.closest('[role="dialog"]'),
  )
}

export function isAccessSeatButton(button) {
  if (button == null || button.tagName !== 'BUTTON') return false
  if (inProtectedChrome(button)) return false
  const aria = String(button.getAttribute('aria-label') || '')
  return aria.indexOf('访问模式') === 0 || aria.indexOf('Access mode') === 0
}

export function isAccessMenuItem(item) {
  if (item == null) return false
  const text = String(item.textContent || '').replace(/\s+/g, ' ').trim()
  for (let i = 0; i < ACCESS_CHIP_LABELS.length; i++) {
    if (text === ACCESS_CHIP_LABELS[i] || text.indexOf(ACCESS_CHIP_LABELS[i]) === 0) return true
  }
  return false
}

const SEAT_HINTS = [
  '即将开始的这个会话所用的 Agent 预设',
  'Agent preset for the session you are about to start',
]

export const PRESET_HIDE_ATTR = 'data-dar-claw-preset'

function mark(el, hide) {
  if (el == null) return
  const current = el.getAttribute(PRESET_HIDE_ATTR) === '1'
  if (hide && !current) el.setAttribute(PRESET_HIDE_ATTR, '1')
  if (!hide && current) el.removeAttribute(PRESET_HIDE_ATTR)
}

export function hideClawPresetSurfaces(doc, ids, names) {
  if (doc == null) return
  const idSet = ids instanceof Set ? ids : new Set(ids || [])
  const nameSet = names instanceof Set ? names : new Set(names || [])
  const codes = doc.querySelectorAll('code')
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]
    if (code.closest('.dar-page')) continue
    const id = String(code.textContent || '').trim()
    const card = code.closest('li') || code.closest('[class*="card"]')
    mark(card, idSet.has(id) || isClawPresetId(id))
  }
  const items = doc.querySelectorAll('[role="menuitem"]')
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (inProtectedChrome(item)) continue
    const hide = isClawPresetMenuLabel(item.textContent, nameSet)
    mark(item, hide)
    const wrap = item.parentElement
    if (wrap && wrap.getAttribute && wrap.getAttribute('role') !== 'menu') mark(wrap, hide)
  }
  const options = doc.querySelectorAll('option')
  for (let i = 0; i < options.length; i++) {
    const option = options[i]
    if (inProtectedChrome(option) || option.closest('.dar-select')) continue
    const value = String(option.value || '').trim()
    const label = String(option.textContent || '').trim()
    const hide = idSet.has(value) || isClawPresetId(value) || nameSet.has(label)
    option.hidden = hide
    option.disabled = hide
  }
}

const WORKSPACE_CHIP_LABELS = ['选择工作区', 'Choose workspace']
const WORKSPACE_ADD_LABELS = ['添加工作区…', 'Add workspace…', '添加工作区', 'Add workspace']

export function isWorkspaceSeatButton(button) {
  if (button == null || button.tagName !== 'BUTTON') return false
  if (inProtectedChrome(button)) return false
  if (button.getAttribute('aria-haspopup') !== 'menu') return false
  const aria = String(button.getAttribute('aria-label') || '')
  for (let i = 0; i < WORKSPACE_CHIP_LABELS.length; i++) {
    if (aria === WORKSPACE_CHIP_LABELS[i]) return true
  }
  return false
}

function isWorkspaceAddLabel(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  for (let i = 0; i < WORKSPACE_ADD_LABELS.length; i++) {
    if (value === WORKSPACE_ADD_LABELS[i] || value.indexOf(WORKSPACE_ADD_LABELS[i]) === 0) return true
  }
  return false
}

export function isPresetSeatButton(button, names) {
  if (button == null || button.tagName !== 'BUTTON') return false
  if (inProtectedChrome(button)) return false
  const hint = String(button.getAttribute('title') || '')
  for (let i = 0; i < SEAT_HINTS.length; i++) {
    if (hint.indexOf(SEAT_HINTS[i]) >= 0) return true
  }
  return false
}

export function hideClawSessionSeat(doc, locked, names) {
  if (doc == null) return
  const buttons = doc.querySelectorAll('button')
  for (let i = 0; i < buttons.length; i++) {
    const button = buttons[i]
    if (isPresetSeatButton(button, names)) {
      mark(button, locked)
      if (locked) button.setAttribute(SEAT_HIDE_ATTR, '1')
      else button.removeAttribute(SEAT_HIDE_ATTR)
    }
    if (isAccessSeatButton(button)) {
      if (locked) button.setAttribute(ACCESS_HIDE_ATTR, '1')
      else button.removeAttribute(ACCESS_HIDE_ATTR)
    }
    if (isWorkspaceSeatButton(button)) {
      if (locked) button.setAttribute(WORKSPACE_HIDE_ATTR, '1')
      else button.removeAttribute(WORKSPACE_HIDE_ATTR)
    }
  }
  const items = doc.querySelectorAll('[role="menuitem"]')
  let pickerMenu = null
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (inProtectedChrome(item)) continue
    if (isWorkspaceAddLabel(item.textContent)) {
      pickerMenu = (typeof item.closest === 'function' && item.closest('[role="menu"]')) || item.parentElement
      break
    }
  }
  if (pickerMenu) {
    if (locked) pickerMenu.setAttribute(WORKSPACE_HIDE_ATTR, '1')
    else pickerMenu.removeAttribute(WORKSPACE_HIDE_ATTR)
  }
}

export function blockClawDefaultClick(event, ids, lockSeat, names) {
  const target = event.target
  if (target == null || typeof target.closest !== 'function') return false
  if (inProtectedChrome(target) || target.closest('[data-dar-zone-switch]')) return false
  if (lockSeat) {
    const seat = target.closest('button')
    if (seat != null && (
      isPresetSeatButton(seat, names)
      || isAccessSeatButton(seat)
      || isWorkspaceSeatButton(seat)
    )) {
      event.preventDefault()
      event.stopPropagation()
      return true
    }
    const item = target.closest('[role="menuitem"]')
    if (item != null && isWorkspaceAddLabel(item.textContent)) {
      event.preventDefault()
      event.stopPropagation()
      return true
    }
    if (item != null && item.closest && item.closest('[' + WORKSPACE_HIDE_ATTR + ']')) {
      event.preventDefault()
      event.stopPropagation()
      return true
    }
  }
  const menuItem = target.closest('[role="menuitem"]')
  if (menuItem != null && !inProtectedChrome(menuItem) && isClawPresetMenuLabel(menuItem.textContent, names)) {
    event.preventDefault()
    event.stopPropagation()
    return true
  }
  const card = target.closest('li') || target.closest('[class*="card"]')
  if (card == null) return false
  const code = card.querySelector('code')
  const id = code == null ? '' : String(code.textContent || '').trim()
  const idSet = ids instanceof Set ? ids : new Set(ids || [])
  if (!idSet.has(id) && !isClawPresetId(id)) return false
  event.preventDefault()
  event.stopPropagation()
  return true
}

export function currentSessionOf(sessions) {
  if (sessions == null || sessions.list == null || typeof sessions.list.getSnapshot !== 'function') {
    return { id: '', row: null }
  }
  const snap = sessions.list.getSnapshot() || {}
  const id = snap.current || ''
  let row = id && snap.byId ? snap.byId[id] : null
  if (id && typeof sessions.get === 'function') {
    try {
      const live = sessions.get(id)
      const header = live && live.header
      if (header && header.agentPreset && (!row || !row.agentPreset)) {
        row = Object.assign({}, row || {}, { agentPreset: header.agentPreset })
      }
    } catch { /* live session optional */ }
  }
  return { id, row }
}
