import { COPY, interpolate, NS, tWith } from './registry-i18n.mjs'
import { ATTR, CSS } from './registry-styles.mjs'
import { agentForSession, boundPresetOf, clawHideKeys, clawHideNames, clawPresetIds, detectClawZone } from './registry-view.mjs'
import { createSettingsPage, registerSettings } from './registry-settings.mjs'
import { createTemplatePage } from './registry-template.mjs'
import { createSidebar } from './registry-sidebar.mjs'
import {
  CLAW_SESSION_ATTR,
  blockClawDefaultClick,
  currentSessionOf,
  hideClawPresetSurfaces,
  hideClawSessionSeat,
} from './registry-preset-hide.mjs'
import { wrapPresetList, wrapSessionSearch, wrapWorkspaceList } from './registry-isolate.mjs'
import { formatObserveFail, newTraceId } from './registry-observe.mjs'

export const ICON = '<svg data-dar-icon="1" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="6" cy="5.5" r="2.2" stroke="currentColor" stroke-width="1.3"/><circle cx="10.5" cy="6.2" r="1.8" stroke="currentColor" stroke-width="1.3"/><path d="M2.6 13.2c.4-2.1 2-3.4 3.4-3.4s3 1.3 3.4 3.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M9.2 12.6c.3-1.4 1.3-2.3 2.3-2.3 1 0 1.8.7 2.2 1.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'

export function apply(ctx) {
  const React = require('react')
  const slots = ctx.get('slots')
  if (slots == null || React == null) return

  const doc = typeof document === 'undefined' ? null : document
  let styleTag = null
  if (doc && doc.head) {
    styleTag = doc.createElement('style')
    styleTag.setAttribute(ATTR, '')
    styleTag.textContent = CSS
    doc.head.appendChild(styleTag)
    doc.body.setAttribute(ATTR, '')
  }

  let localeDispose = function () {}
  try {
    if (ctx.locale && typeof ctx.locale.register === 'function') {
      localeDispose = ctx.locale.register(NS, COPY) || function () {}
    }
  } catch { /* remount */ }

  function t(key, params) {
    return interpolate(tWith(ctx, key, params), params)
  }

  function subscribeLocale(fn) {
    if (ctx.locale && typeof ctx.locale.subscribe === 'function') {
      return ctx.locale.subscribe(fn) || function () {}
    }
    return function () {}
  }

  function post(path, payload) {
    const traceId = newTraceId()
    return fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-DSH-Agent-Registry': '1',
        'X-DSH-Trace': traceId,
      },
      body: JSON.stringify(payload || {}),
    }).then((res) => res.json().then((data) => {
      if (!res.ok && (!data || data.ok !== true)) {
        const error = new Error(formatObserveFail(data, 'http ' + res.status))
        error.code = data && data.code
        error.traceId = (data && data.traceId) || traceId
        throw error
      }
      return data
    }))
  }

  function toast(message) {
    if (!doc) return
    const existing = doc.querySelector('.dar-toast')
    if (existing) existing.remove()
    const el = document.createElement('div')
    el.className = 'dar-toast'
    el.textContent = message
    doc.body.appendChild(el)
    setTimeout(() => { if (el.parentNode) el.remove() }, 1800)
  }

  function swapNavIcon() {
    if (!doc) return
    const dialogs = doc.querySelectorAll('[role="dialog"]')
    for (let d = 0; d < dialogs.length; d++) {
      const buttons = dialogs[d].querySelectorAll('nav button, [class*="nav"] button')
      for (let i = 0; i < buttons.length; i++) {
        const label = String(buttons[i].textContent || '').trim()
        if (
          label !== '工作区 Agent' && label !== 'Workspace agents'
          && label !== 'claw区agent' && label !== 'Claw agents' && label !== 'Claw Agent'
          && label !== 'Claw Agent模板' && label !== 'Claw agent template'
        ) continue
        const svg = buttons[i].querySelector('svg')
        if (svg == null || svg.getAttribute('data-dar-icon') === '1') continue
        svg.outerHTML = ICON
      }
    }
  }

  let ReactDOM = null
  try { ReactDOM = require('react-dom') } catch { /* optional */ }
  const Page = createSettingsPage(React, t, post, toast, subscribeLocale, ReactDOM)
  const TemplatePage = createTemplatePage(React, t, post, toast, subscribeLocale, ReactDOM)
  const stopSettings = registerSettings(ctx, React, t, Page, TemplatePage)

  let projected = null

  function connectionApi() {
    try {
      const conn = ctx.connection || (typeof ctx.get === 'function' ? ctx.get('connection') : null)
      return conn && conn.api ? conn.api : null
    } catch {
      return null
    }
  }

  function clawLock() {
    const current = currentSessionOf(ctx.sessions)
    const agent = agentForSession(projected, current.id, current.row)
    return { current, agent, preset: boundPresetOf(agent) }
  }

  const sidebarApi = {
    t,
    getProjected() { return projected },
    clientSessions() { return ctx.sessions || null },
    startSession(workspaceId) {
      if (!workspaceId) return
      const agents = (projected && projected.agents) || []
      const agent = agents.find((row) => row && String(row.workspaceId) === String(workspaceId))
      const api = connectionApi()
      if (api && api.sessions && typeof api.sessions.create === 'function' && agent) {
        Promise.resolve(api.sessions.create({ workspaceId, agentPreset: 'standard' })).then((res) => {
          const value = res && res.result && res.result.ok === true ? res.result.value : null
          const id = value && value.sessionId
          if (!id) throw new Error('session create failed')
          if (ctx.sessions && typeof ctx.sessions.open === 'function') ctx.sessions.open(id)
          const model = agent && agent.model
          if (model && model.provider && model.model && api.sessions && typeof api.sessions.selectModel === 'function') {
            return Promise.resolve(api.sessions.selectModel({
              sessionId: id,
              provider: model.provider,
              model: model.model,
              reasoningEffort: model.reasoningEffort,
            })).catch(() => {})
          }
        }).catch(() => {
          if (ctx.workspaces && typeof ctx.workspaces.startSession === 'function') ctx.workspaces.startSession(workspaceId)
        })
        return
      }
      if (ctx.workspaces && typeof ctx.workspaces.startSession === 'function') ctx.workspaces.startSession(workspaceId)
    },
    archiveAgent(agentId) {
      return post('/dsh-agent-registry/archive', { agentId }).then(() => loadProjected())
    },
    renameAgent(agentId, name) {
      return post('/dsh-agent-registry/rename', { agentId, name }).then((data) => {
        const workspaceId = data && data.agent && data.agent.workspaceId
        if (workspaceId && ctx.workspaces && typeof ctx.workspaces.rename === 'function') {
          return Promise.resolve(ctx.workspaces.rename(workspaceId, name)).then(() => loadProjected())
        }
        return loadProjected()
      })
    },
    renameSession(sessionId, name) {
      const sessions = ctx.sessions
      if (sessions == null) return Promise.resolve()
      const bound = typeof sessions.binding === 'function' ? sessions.binding(sessionId) : null
      const session = (bound && bound.session)
        || (typeof sessions.get === 'function' ? sessions.get(sessionId) : null)
      if (session == null || typeof session.rename !== 'function') return Promise.resolve()
      return Promise.resolve(session.rename(name)).then(() => loadProjected())
    },
    forkSession(sessionId) {
      const sessions = ctx.sessions
      if (sessions == null || typeof sessions.fork !== 'function') return
      Promise.resolve(sessions.fork({ sessionId, increaseTitle: true })).then((childId) => {
        if (childId && typeof sessions.open === 'function') sessions.open(childId)
      })
    },
    archiveSession(sessionId) {
      if (ctx.workspaces == null || typeof ctx.workspaces.archiveSession !== 'function') return Promise.resolve()
      return Promise.resolve(ctx.workspaces.archiveSession(sessionId)).then(() => loadProjected())
    },
    copySessionId(sessionId) {
      if (!sessionId) return
      const done = () => toast(t('copiedSessionId'))
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(sessionId).then(done).catch(() => toast(t('fail')))
        return
      }
      toast(t('fail'))
    },
    exportSession(sessionId) {
      return fetch('/dsh-session-actions/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DSH-Session-Actions': '1' },
        body: JSON.stringify({ sessionId }),
      }).then((res) => res.json()).then((data) => {
        if (!data || data.ok !== true || !data.markdown) {
          toast(t('fail'))
          return
        }
        const blob = new Blob([data.markdown], { type: 'text/markdown;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = data.filename || 'session.md'
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => { URL.revokeObjectURL(url) }, 3000)
      }).catch(() => toast(t('fail')))
    },
    deleteSession(sessionId) {
      return fetch('/dsh-session-actions/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DSH-Session-Actions': '1' },
        body: JSON.stringify({ sessionId }),
      }).then((res) => res.json()).then((data) => {
        if (!data || data.ok !== true) toast(t('fail'))
        return loadProjected()
      }).catch(() => toast(t('fail')))
    },
    openSession(sessionId) {
      if (!sessionId || ctx.sessions == null || typeof ctx.sessions.open !== 'function') return
      ctx.sessions.open(sessionId)
    },
    onZone() { paintOverlays() },
    createAgent(name) {
      return post('/dsh-agent-registry/create', { name }).then((data) => {
        toast(t('created', { name: (data.agent && data.agent.title) || name }))
        return loadProjected()
      }).catch((err) => {
        toast(String(err.message || t('fail')))
      })
    },
  }
  const sidebar = doc ? createSidebar(doc, sidebarApi) : null

  function paintOverlays() {
    swapNavIcon()
    if (sidebar) sidebar.render()
    const names = clawHideNames(projected)
    const locked = Boolean(clawLock().agent) || detectClawZone(doc)
    hideClawPresetSurfaces(doc, clawPresetIds(projected), names)
    hideClawSessionSeat(doc, locked, names)
    if (doc && doc.body) {
      if (locked) doc.body.setAttribute(CLAW_SESSION_ATTR, '1')
      else doc.body.removeAttribute(CLAW_SESSION_ATTR)
    }
  }

  function loadProjected() {
    return post('/dsh-agent-registry/list', {}).then((next) => {
      projected = next
      paintOverlays()
      const list = ctx.workspaces && ctx.workspaces.list
      if (list && typeof list.set === 'function' && typeof list.getSnapshot === 'function') {
        list.set(list.getSnapshot())
      }
      return next
    }).catch(() => {
      paintOverlays()
    })
  }

  ctx.effect(() => {
    let observer = null
    let timer = null
    let reloadTimer = null
    let unsubSessions = function () {}
    const stopPresetList = wrapPresetList(connectionApi())
    const stopWorkspaceList = wrapWorkspaceList(ctx.workspaces && ctx.workspaces.list, function () {
      const current = currentSessionOf(ctx.sessions)
      const row = current && current.row
      return Object.assign({}, clawHideKeys(projected), {
        currentSessionId: current && current.id ? current.id : '',
        currentCwd: row && (row.cwd || row.path) ? String(row.cwd || row.path) : '',
      })
    })
    const stopSessionSearch = wrapSessionSearch(ctx.sessions, function () {
      return clawHideKeys(projected)
    })
    const onClick = function (event) {
      blockClawDefaultClick(event, clawPresetIds(projected), Boolean(clawLock().agent) || detectClawZone(doc), clawHideNames(projected))
    }
    if (doc) {
      observer = new MutationObserver(function () {
        if (timer != null) clearTimeout(timer)
        timer = setTimeout(function () {
          timer = null
          paintOverlays()
        }, 32)
      })
      observer.observe(doc.body, { childList: true, subtree: true })
      doc.addEventListener('click', onClick, true)
      paintOverlays()
      loadProjected()
    }
    try {
      const sessions = ctx.sessions
      if (sessions != null && sessions.list != null && typeof sessions.list.subscribe === 'function') {
        unsubSessions = sessions.list.subscribe(function () {
          paintOverlays()
          if (reloadTimer != null) clearTimeout(reloadTimer)
          reloadTimer = setTimeout(function () {
            reloadTimer = null
            loadProjected()
          }, 250)
        }) || function () {}
      }
    } catch { /* sessions optional at subscribe time */ }
    return function () {
      localeDispose()
      unsubSessions()
      if (typeof stopPresetList === 'function') stopPresetList()
      if (typeof stopWorkspaceList === 'function') stopWorkspaceList()
      if (typeof stopSessionSearch === 'function') stopSessionSearch()
      if (timer != null) clearTimeout(timer)
      if (reloadTimer != null) clearTimeout(reloadTimer)
      if (observer) observer.disconnect()
      if (doc) doc.removeEventListener('click', onClick, true)
      if (sidebar) sidebar.remove()
      if (typeof stopSettings === 'function') stopSettings()
      if (styleTag != null) styleTag.remove()
      if (doc) {
        const marked = doc.querySelectorAll('[data-dar-claw-hide],[data-dar-claw-preset],[data-dar-tree-hide],[data-dar-zone-hide],[data-dar-seat-hide],[data-dar-access-hide],[data-dar-workspace-hide],[data-dar-claw-actions],[data-dar-search-hide],[data-dar-search-scope],[data-dar-search-ph]')
        for (let i = 0; i < marked.length; i++) {
          marked[i].removeAttribute('data-dar-claw-hide')
          marked[i].removeAttribute('data-dar-claw-preset')
          marked[i].removeAttribute('data-dar-tree-hide')
          marked[i].removeAttribute('data-dar-zone-hide')
          marked[i].removeAttribute('data-dar-seat-hide')
          marked[i].removeAttribute('data-dar-access-hide')
          marked[i].removeAttribute('data-dar-workspace-hide')
          marked[i].removeAttribute('data-dar-claw-actions')
          marked[i].removeAttribute('data-dar-search-hide')
          marked[i].removeAttribute('data-dar-search-scope')
          marked[i].removeAttribute('data-dar-search-ph')
        }
        doc.body.removeAttribute(CLAW_SESSION_ATTR)
        doc.body.removeAttribute('data-dar-zone')
        doc.body.removeAttribute(ATTR)
      }
    }
  })
}
