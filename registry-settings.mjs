import { NS } from './registry-i18n.mjs'
import { effortLabel, findCatalogModel, modelKey, normalizeModel } from './registry-model.mjs'
import { selectableAgents } from './registry-view.mjs'
import {
  AGENT_PRESET_IDS,
  TOOL_IDS,
  applyPreset,
  clawHardCap,
  clampClawPolicy,
  isToolEnabled,
  normalizePolicy,
  optionAllowed,
  toggleTool,
} from './registry-presets.mjs'
import { CLIENT_CODES, formatObserveFail, newTraceId } from './registry-observe.mjs'

const TABS = ['overview', 'persona', 'memory', 'model', 'permissions', 'skills']

function dateStamp(now) {
  const stamp = now instanceof Date ? now : new Date()
  const y = stamp.getFullYear()
  const m = String(stamp.getMonth() + 1).padStart(2, '0')
  const d = String(stamp.getDate()).padStart(2, '0')
  return y + '-' + m + '-' + d
}

function yesterdayStamp(now) {
  const stamp = now instanceof Date ? now : new Date()
  return dateStamp(new Date(stamp.getTime() - 86400000))
}

function coreFiles(daily) {
  const today = (daily && daily.today) || dateStamp()
  const yesterday = (daily && daily.yesterday) || yesterdayStamp()
  return [
    { key: 'agents', file: 'AGENTS.md', via: 'identity' },
    { key: 'soul', file: 'SOUL.md', via: 'identity' },
    { key: 'tools', file: 'TOOLS.md', via: 'identity' },
    { key: 'identity', file: 'IDENTITY.md', via: 'identity' },
    { key: 'user', file: 'USER.md', via: 'memory', vault: 'user' },
    { key: 'heartbeat', file: 'HEARTBEAT.md', via: 'identity' },
    { key: 'memory', file: 'MEMORY.md', via: 'memory', vault: 'memory' },
    { key: 'dailyYesterday', file: 'memory/' + yesterday + '.md', via: 'daily', dateKey: yesterday },
    { key: 'dailyToday', file: 'memory/' + today + '.md', via: 'daily', dateKey: today },
  ]
}

function emptyPersona() {
  return { agents: '', soul: '', tools: '', identity: '', user: '', heartbeat: '', memory: '', dailyToday: '', dailyYesterday: '' }
}

function personaFromFiles(files) {
  const src = files || {}
  return {
    agents: src['AGENTS.md'] || '',
    soul: src['SOUL.md'] || '',
    tools: src['TOOLS.md'] || '',
    identity: src['IDENTITY.md'] || '',
    heartbeat: src['HEARTBEAT.md'] || '',
  }
}

function coreSpec(key, daily) {
  const rows = coreFiles(daily)
  return rows.find((row) => row.key === key) || rows[0]
}

export function createSettingsPage(React, t, post, toast, subscribeLocale, ReactDOM) {
  return function RegistryPage() {
    const el = React.createElement
    function svgIcon(className, d) {
      return el('svg', {
        className,
        width: 14,
        height: 14,
        viewBox: '0 0 14 14',
        fill: 'none',
        'aria-hidden': 'true',
      }, el('path', {
        d,
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }))
    }
    const [, setLocaleTick] = React.useState(0)
    React.useEffect(() => {
      if (typeof subscribeLocale !== 'function') return undefined
      return subscribeLocale(() => setLocaleTick((n) => n + 1))
    }, [subscribeLocale])
    const [data, setData] = React.useState(null)
    const [error, setError] = React.useState('')
    const [selected, setSelected] = React.useState('')
    const [tab, setTab] = React.useState('overview')
    const [busy, setBusy] = React.useState(false)
    const [confirm, setConfirm] = React.useState(false)
    const [persona, setPersona] = React.useState(emptyPersona)
    const [personaSaved, setPersonaSaved] = React.useState(emptyPersona)
    const [coreFile, setCoreFile] = React.useState(coreFiles()[0].key)
    const [resetConfirm, setResetConfirm] = React.useState(false)
    const [personaBusy, setPersonaBusy] = React.useState(false)
    const [vault, setVault] = React.useState(null)
    const [dailyMeta, setDailyMeta] = React.useState({ today: dateStamp(), yesterday: yesterdayStamp() })
    const [policy, setPolicy] = React.useState(null)
    const [policyBusy, setPolicyBusy] = React.useState(false)
    const [skillItems, setSkillItems] = React.useState([])
    const [skillDeny, setSkillDeny] = React.useState([])
    const [skillBusy, setSkillBusy] = React.useState(false)
    const [catalog, setCatalog] = React.useState({ official: null, groups: [] })
    const [modelBusy, setModelBusy] = React.useState(false)
    const [modelOpen, setModelOpen] = React.useState(false)
    const [modelPane, setModelPane] = React.useState('root')
    const [menuPos, setMenuPos] = React.useState(null)
    const [pickOpen, setPickOpen] = React.useState('')
    const [pickPos, setPickPos] = React.useState(null)
    const modelRootRef = React.useRef(null)
    const agentPickRef = React.useRef(null)
    const filePickRef = React.useRef(null)

    const load = React.useCallback(() => {
      return post('/dsh-agent-registry/list', {}).then((next) => {
        setData(next)
        setError('')
      }).catch((err) => {
        setError(String(err.message || err))
      })
    }, [])

    React.useEffect(() => { load() }, [load])

    const choices = selectableAgents(data, { main: t('mainOption'), archived: t('statusArchived') })
    const current = choices.find((row) => row.agentId === selected) || choices[0]
    const agent = current && current.agent
    const isMain = false
    const leaveBehind = (data && data.leaveBehind) || 'archive'

    React.useEffect(() => {
      if (choices.length === 0) return
      if (!choices.some((row) => row.agentId === selected)) setSelected(choices[0].agentId)
    }, [choices, selected])

    function act(path) {
      if (!current || isMain) return
      setBusy(true)
      post(path, { agentId: current.agentId }).then(() => load()).catch((err) => {
        toast(String(err.message || t('fail')))
      }).finally(() => {
        setBusy(false)
        setConfirm(false)
      })
    }

    function saveLeaveBehind(mode) {
      if (mode === leaveBehind) return
      setBusy(true)
      post('/dsh-agent-registry/leave-behind', { leaveBehind: mode }).then(() => load()).catch((err) => {
        toast(String(err.message || t('fail')))
      }).finally(() => setBusy(false))
    }

    function copyId() {
      const id = current && current.agentId
      if (!id) return
      const done = () => toast(t('copied'))
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(id).then(done).catch(() => toast(t('fail')))
        return
      }
      toast(t('fail'))
    }

    function fact(label, value) {
      return el('div', { className: 'dar-fact' },
        el('div', { className: 'dar-fact-k' }, label),
        el('div', { className: 'dar-fact-v' }, value == null || value === '' ? '—' : String(value)),
      )
    }

    function row(label, value) {
      return el('div', { className: 'dar-row' },
        el('span', { className: 'dar-k' }, label),
        el('span', { className: 'dar-v' }, value == null || value === '' ? '—' : String(value)),
      )
    }

    function overviewPanel() {
      const declared = (agent && agent.declared) || {}
      return el('div', { className: 'dar-panel-body' },
        el('div', { className: 'dar-facts' },
          fact(t('workspace'), agent && (agent.title || agent.workspaceId)),
          fact(t('path'), agent && agent.canonicalRoot),
          fact(t('preset'), (() => {
            const id = declared.preset || (agent && agent.preset)
            if (!id) return ''
            const label = t('preset_' + id)
            return label === ('preset_' + id) ? id : label
          })()),
          fact(t('dshPreset'), agent && agent.dshPreset),
          fact(t('sessions'), agent && String(agent.sessionCount || 0)),
          fact(t('status'), agent && agent.status === 'archived' ? t('statusArchived') : t('statusActive')),
        ),
        agent && !agent.workspacePresent ? el('p', { className: 'dar-note' }, t('missingWorkspace')) : null,
        el('div', { className: 'dar-leave' },
          el('div', { className: 'dar-fact-k' }, t('leaveBehind')),
          el('p', { className: 'dar-note' }, t('leaveBehindHint')),
          el('div', { className: 'dar-segs' }, ['archive', 'transfer', 'delete'].map((id) => el('button', {
            key: id,
            type: 'button',
            className: 'dar-seg',
            'data-on': leaveBehind === id ? 'true' : 'false',
            disabled: busy,
            onClick() { saveLeaveBehind(id) },
          }, t('leaveBehind' + id.charAt(0).toUpperCase() + id.slice(1))))),
          el('p', { className: 'dar-note' }, t('leaveBehind' + leaveBehind.charAt(0).toUpperCase() + leaveBehind.slice(1) + 'Hint')),
        ),
      )
    }

    const root = agent && agent.files && agent.files.root
    const fetchGen = React.useRef(0)
    const rootRef = React.useRef(root)
    rootRef.current = root

    React.useEffect(() => {
      setResetConfirm(false)
      const gen = fetchGen.current + 1
      fetchGen.current = gen
      const ac = typeof AbortController === 'function' ? new AbortController() : null
      if (!root) {
        const blank = emptyPersona()
        setPersona(blank)
        setPersonaSaved(blank)
        return
      }
      fetch('/dsh-agent-identity/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DSH-Agent-Identity': '1' },
        body: JSON.stringify({ root }),
        signal: ac && ac.signal,
      }).then((res) => res.json()).then((data) => {
        if (gen !== fetchGen.current) {
          reportStale('load_persona')
          return
        }
        if (!data || data.ok !== true) return
        const next = personaFromFiles(data.files)
        setPersona((prev) => ({ ...prev, ...next }))
        setPersonaSaved((prev) => ({ ...prev, ...next }))
      }).catch(() => {})
      reloadVault(root, gen, ac && ac.signal)
      return () => { if (ac) ac.abort() }
    }, [root])

    function reportStale(name) {
      fetch('/dsh-agent-registry/diag', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-DSH-Agent-Registry': '1',
          'X-DSH-Trace': newTraceId(),
        },
        body: JSON.stringify({ code: CLIENT_CODES.REGISTRY_RESPONSE_STALE, operation: name }),
      }).catch(() => {})
    }

    function applyVault(data, expectedRoot, gen) {
      if ((gen != null && gen !== fetchGen.current) || (expectedRoot && expectedRoot !== rootRef.current)) {
        reportStale('load_vault')
        return
      }
      if (!data || data.ok !== true) return
      setVault(data)
      const next = {}
      if (data.user && typeof data.user.raw === 'string') next.user = data.user.raw
      if (data.memory && typeof data.memory.raw === 'string') next.memory = data.memory.raw
      if (data.daily) {
        setDailyMeta({ today: data.daily.today, yesterday: data.daily.yesterday })
        next.dailyToday = data.daily.todayText || ''
        next.dailyYesterday = data.daily.yesterdayText || ''
      }
      if (Object.keys(next).length === 0) return
      setPersona((prev) => ({ ...prev, ...next }))
      setPersonaSaved((prev) => ({ ...prev, ...next }))
    }

    function reloadVault(nextRoot, gen, signal) {
      const path = nextRoot || root
      if (!path) return Promise.resolve()
      return fetch('/dsh-agent-memory/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DSH-Agent-Memory': '1' },
        body: JSON.stringify({ root: path }),
        signal,
      }).then((res) => res.json()).then((data) => applyVault(data, path, gen)).catch(() => {})
    }

    function saveCoreFile() {
      const spec = coreSpec(coreFile, dailyMeta)
      if (!root || !spec) return
      const content = persona[spec.key]
      const saveRoot = root
      const saveGen = fetchGen.current
      setPersonaBusy(true)
      const request = spec.via === 'daily'
        ? fetch('/dsh-agent-memory/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-DSH-Agent-Memory': '1' },
          body: JSON.stringify({ root: saveRoot, action: 'save', target: 'daily', key: spec.dateKey, content }),
        }).then((res) => res.json())
        : spec.via === 'memory'
        ? fetch('/dsh-agent-memory/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-DSH-Agent-Memory': '1' },
          body: JSON.stringify({ root: saveRoot, action: 'save', target: spec.vault, content }),
        }).then((res) => res.json())
        : fetch('/dsh-agent-identity/write', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-DSH-Agent-Identity': '1' },
          body: JSON.stringify({ root: saveRoot, files: { [spec.file]: content } }),
        }).then((res) => res.json())
      request.then((row) => {
        if (saveGen !== fetchGen.current || saveRoot !== rootRef.current) {
          reportStale('save_persona')
          return
        }
        if (!row || row.ok !== true) {
          toast(formatObserveFail(row, t('fail')))
          return
        }
        setPersonaSaved((prev) => ({ ...prev, [spec.key]: content }))
        if (spec.via === 'memory' && row.usage) {
          setVault((prev) => ({
            ...(prev || {}),
            [spec.vault]: { ...((prev && prev[spec.vault]) || {}), usage: row.usage },
          }))
        }
        toast(t('saved'))
      }).catch(() => toast(t('fail'))).finally(() => setPersonaBusy(false))
    }

    function resetCoreFile() {
      const spec = coreSpec(coreFile, dailyMeta)
      setPersona((prev) => ({ ...prev, [spec.key]: personaSaved[spec.key] }))
      setResetConfirm(false)
    }

    function personaPanel() {
      const files = coreFiles(dailyMeta)
      const spec = coreSpec(coreFile, dailyMeta)
      const dirty = persona[spec.key] !== personaSaved[spec.key]
      const usage = spec.vault && vault && vault[spec.vault] && vault[spec.vault].usage
        ? vault[spec.vault].usage.used + '/' + vault[spec.vault].usage.limit
        : ''
      return el('div', { className: 'dar-panel-body' },
        el('div', { className: 'dar-pick-wrap dar-pick-block' },
          pickTrigger(
            filePickRef,
            'file',
            spec.file + (dirty ? ' *' : ''),
            t('selectFile'),
            !root,
          ),
          pickOpen === 'file'
            ? pickMenu(files.map((row) => ({
              id: row.key,
              label: row.file + (persona[row.key] !== personaSaved[row.key] ? ' *' : ''),
            })), spec.key, (key) => {
              setCoreFile(key)
              setResetConfirm(false)
            })
            : null,
        ),
        el('label', { className: 'dar-file' },
          usage ? el('div', { className: 'dar-file-path' }, usage) : null,
          el('textarea', {
            className: 'dar-textarea dar-textarea-core',
            value: persona[spec.key],
            rows: 18,
            spellCheck: false,
            onChange(e) { setPersona((prev) => ({ ...prev, [spec.key]: e.target.value })) },
          }),
        ),
        el('div', { className: 'dar-file-actions' },
          el('button', {
            type: 'button',
            className: 'dar-btn',
            disabled: personaBusy || !root || !dirty,
            onClick() { closePick(); setResetConfirm(true) },
          }, t('resetFile')),
          el('button', {
            type: 'button',
            className: 'dar-btn',
            disabled: personaBusy || !root || !dirty,
            onClick: saveCoreFile,
          }, t('saveFile')),
        ),
      )
    }

    function saveMemSettings(next) {
      fetch('/dsh-agent-memory/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DSH-Agent-Memory': '1' },
        body: JSON.stringify({ settings: next }),
      }).then((res) => res.json()).then((data) => {
        if (!data || data.ok !== true) {
          toast((data && data.error) || t('fail'))
          return
        }
        setVault((prev) => ({ ...(prev || {}), settings: data.settings }))
        toast(t('saved'))
      }).catch(() => toast(t('fail')))
    }

    function actPending(action, id) {
      if (!root) return
      fetch('/dsh-agent-memory/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DSH-Agent-Memory': '1' },
        body: JSON.stringify({ root, action, id }),
      }).then((res) => res.json()).then((data) => {
        if (!data || data.ok !== true) {
          toast((data && data.error) || t('fail'))
          return
        }
        toast(t('saved'))
        return reloadVault()
      }).catch(() => toast(t('fail')))
    }

    function memoryPanel() {
      const settings = (vault && vault.settings) || { writeApproval: false, review: { enabled: true } }
      const pending = (vault && vault.pending) || []
      const reviewOn = !(settings.review && settings.review.enabled === false)
      return el('div', { className: 'dar-panel-body' },
        permField(t('memWrite'), segs(settings.writeApproval ? 'ask' : 'free', [
          { id: 'free', label: t('memWriteFree') },
          { id: 'ask', label: t('memWriteAsk') },
        ], (id) => saveMemSettings({ ...settings, writeApproval: id === 'ask' }))),
        permField(t('memReview'), segs(reviewOn ? 'on' : 'off', [
          { id: 'on', label: t('memReviewOn') },
          { id: 'off', label: t('memReviewOff') },
        ], (id) => saveMemSettings({
          ...settings,
          review: { ...(settings.review || {}), enabled: id === 'on' },
        }))),
        el('div', { className: 'dar-perm-k' }, t('memPending')),
        pending.length === 0
          ? el('p', { className: 'dar-empty' }, t('memPendingEmpty'))
          : pending.map((row) => el('div', { key: row.id, className: 'dar-pending' },
            el('div', { className: 'dar-pending-k' }, [row.action, row.target].filter(Boolean).join(' ')),
            el('div', { className: 'dar-pending-v' }, row.content || row.old_text || row.id),
            el('div', { className: 'dar-file-actions' },
              el('button', {
                type: 'button',
                className: 'dar-btn',
                disabled: !root,
                onClick() { actPending('approve', row.id) },
              }, t('memApprove')),
              el('button', {
                type: 'button',
                className: 'dar-btn dar-danger',
                disabled: !root,
                onClick() { actPending('reject', row.id) },
              }, t('memReject')),
            ),
          )),
      )
    }

    function closeModelMenu() {
      setModelOpen(false)
      setModelPane('root')
    }

    function closePick() {
      setPickOpen('')
      setPickPos(null)
    }

    function pickTrigger(ref, id, label, ariaLabel, disabled) {
      const open = pickOpen === id
      return el('button', {
        type: 'button',
        ref,
        className: 'dar-pick',
        'aria-haspopup': 'menu',
        'aria-expanded': open ? 'true' : 'false',
        'aria-label': ariaLabel,
        disabled: Boolean(disabled),
        onClick() {
          if (open) {
            closePick()
            return
          }
          closeModelMenu()
          setPickOpen(id)
        },
      },
        el('span', { className: 'dar-pick-label' }, label || '—'),
        svgIcon('dar-pick-chevron' + (open ? ' is-open' : ''), 'M3 5l4 4 4-4'),
      )
    }

    function pickMenu(items, selectedId, onSelect) {
      if (!pickOpen || !pickPos) return null
      const menu = el('div', {
        className: 'dar-ms-menu',
        role: 'menu',
        'data-dar-pick-menu': pickOpen,
        style: {
          top: pickPos.top + 'px',
          left: pickPos.left + 'px',
          width: pickPos.width + 'px',
        },
      }, (items || []).map((item) => {
        const on = item.id === selectedId
        return el('button', {
          key: item.id,
          type: 'button',
          role: 'menuitemradio',
          'aria-checked': on ? 'true' : 'false',
          className: 'dar-ms-option' + (on ? ' is-on' : ''),
          onClick() {
            onSelect(item.id)
            closePick()
          },
        },
          el('span', { className: 'dar-ms-option-name' }, item.label),
          on ? svgIcon('dar-ms-check', 'M2.5 7.5l3 3 6-6') : null,
        )
      }))
      if (ReactDOM && typeof ReactDOM.createPortal === 'function' && typeof document !== 'undefined' && document.body) {
        return ReactDOM.createPortal(menu, document.body)
      }
      return menu
    }

    function modelPanel() {
      const pinned = normalizeModel(agent && agent.model)
      const inherit = !pinned
      const live = pinned || normalizeModel(catalog.official)
      const hit = live ? findCatalogModel(catalog.groups, live.provider, live.model) : null
      const reasoning = hit && hit.model && hit.model.reasoning
      const modelLabel = inherit
        ? (hit && hit.model && hit.model.name) || (live && live.model) || t('modelInherit')
        : (hit && hit.model && hit.model.name) || live.model
      const effortText = effortLabel(reasoning, live && live.reasoningEffort, '')
      const empty = !catalog.groups || catalog.groups.every((group) => !group.models || group.models.length === 0)
      return el('div', { className: 'dar-panel-body' },
        el('div', { className: 'dar-perm-item', 'data-span': '2' },
        el('div', { className: 'dar-perm-k' }, t('modelDefault')),
        el('div', {
          className: 'dar-ms',
          ref: modelRootRef,
          'data-dar-ms': '1',
        },
          el('button', {
            type: 'button',
            className: 'dar-ms-trigger',
            disabled: modelBusy || !current,
            'aria-haspopup': 'menu',
            'aria-expanded': modelOpen ? 'true' : 'false',
            'aria-label': t('modelMenu'),
            onClick() {
              if (modelOpen) closeModelMenu()
              else {
                closePick()
                setModelPane('root')
                setModelOpen(true)
              }
            },
          },
            el('span', { className: 'dar-ms-trigger-label' }, modelLabel || t('modelFallback')),
            effortText ? el('span', { className: 'dar-ms-trigger-effort' }, effortText) : null,
            svgIcon('dar-ms-chevron' + (modelOpen ? ' is-open' : ''), 'M3 5l4 4 4-4'),
          ),
          (function () {
            if (!modelOpen || !menuPos) return null
            const menu = el('div', {
              className: 'dar-ms-menu',
              role: 'menu',
              'data-dar-ms-menu': '1',
              'aria-label': t('modelMenu'),
              style: {
                top: menuPos.top + 'px',
                left: menuPos.left + 'px',
                width: menuPos.width + 'px',
              },
            },
            modelPane === 'root' ? el(React.Fragment, null,
              el('button', {
                type: 'button',
                role: 'menuitem',
                className: 'dar-ms-cell',
                onClick() { setModelPane('model') },
              },
                el('span', { className: 'dar-ms-cell-label' }, t('modelRow')),
                el('span', { className: 'dar-ms-cell-value' }, modelLabel),
                svgIcon('dar-ms-cell-chevron', 'M5 3l4 4-4 4'),
              ),
              reasoning ? el('button', {
                type: 'button',
                role: 'menuitem',
                className: 'dar-ms-cell',
                onClick() { setModelPane('effort') },
              },
                el('span', { className: 'dar-ms-cell-label' }, t('modelEffort')),
                el('span', { className: 'dar-ms-cell-value' }, effortText || t('modelOfficial')),
                svgIcon('dar-ms-cell-chevron', 'M5 3l4 4-4 4'),
              ) : null,
            ) : null,
            modelPane === 'model' ? el('div', { className: 'dar-ms-groups' },
              el('button', {
                type: 'button',
                role: 'menuitemradio',
                'aria-checked': inherit ? 'true' : 'false',
                className: 'dar-ms-option' + (inherit ? ' is-on' : ''),
                onClick() { saveModel(null); closeModelMenu() },
              },
                el('span', { className: 'dar-ms-option-name' }, t('modelInherit')),
                inherit ? svgIcon('dar-ms-check', 'M2.5 7.5l3 3 6-6') : null,
              ),
              (catalog.groups || []).map((group) => el('section', {
                key: group.id,
                className: 'dar-ms-group',
              },
                el('div', { className: 'dar-ms-group-title' }, group.name || group.id),
                (group.models || []).map((item) => {
                  const on = !inherit && live && live.provider === group.id && live.model === item.id
                  return el('button', {
                    key: item.id,
                    type: 'button',
                    role: 'menuitemradio',
                    'aria-checked': on ? 'true' : 'false',
                    className: 'dar-ms-option' + (on ? ' is-on' : ''),
                    disabled: modelBusy,
                    onClick() {
                      const next = { provider: group.id, model: item.id }
                      if (item.reasoning && item.reasoning.defaultEffort) {
                        next.reasoningEffort = item.reasoning.defaultEffort
                      }
                      saveModel(next)
                      closeModelMenu()
                    },
                  },
                    el('span', { className: 'dar-ms-option-name' }, item.name || item.id),
                    on ? svgIcon('dar-ms-check', 'M2.5 7.5l3 3 6-6') : null,
                  )
                }),
              )),
              empty ? el('div', { className: 'dar-ms-empty' }, t('modelEmpty')) : null,
            ) : null,
            modelPane === 'effort' ? el(React.Fragment, null,
              !(reasoning && reasoning.efforts && reasoning.efforts.length)
                ? el('div', { className: 'dar-ms-empty' }, t('modelNoEffort'))
                : (reasoning.efforts || []).map((row) => {
                  const on = (live && live.reasoningEffort || reasoning.defaultEffort) === row.id
                  return el('button', {
                    key: row.id,
                    type: 'button',
                    role: 'menuitemradio',
                    'aria-checked': on ? 'true' : 'false',
                    className: 'dar-ms-option' + (on ? ' is-on' : ''),
                    disabled: modelBusy || !live,
                    onClick() {
                      saveModel({
                        provider: live.provider,
                        model: live.model,
                        reasoningEffort: row.id,
                      })
                      closeModelMenu()
                    },
                  },
                    el('span', { className: 'dar-ms-option-name' }, row.name || row.id),
                    on ? svgIcon('dar-ms-check', 'M2.5 7.5l3 3 6-6') : null,
                  )
                }),
            ) : null,
            )
            if (ReactDOM && typeof ReactDOM.createPortal === 'function' && typeof document !== 'undefined' && document.body) {
              return ReactDOM.createPortal(menu, document.body)
            }
            return menu
          }()),
        ),
        ),
      )
    }

    React.useEffect(() => {
      if (!agent) {
        setPolicy(null)
        setSkillDeny([])
        return
      }
      const next = clampClawPolicy(normalizePolicy(agent.policy || agent.declared, agent.preset))
      setPolicy(next)
      setSkillDeny(((next.skills && next.skills.deny) || []).slice())
    }, [agent && agent.agentId, agent && agent.policyVersion])

    React.useEffect(() => {
      if (!modelOpen) {
        setMenuPos(null)
        return undefined
      }
      const place = () => {
        const root = modelRootRef.current
        const btn = root && root.querySelector ? root.querySelector('.dar-ms-trigger') : root
        if (!btn || typeof btn.getBoundingClientRect !== 'function') return
        const box = btn.getBoundingClientRect()
        const width = Math.min(260, Math.max(200, window.innerWidth - 16))
        let left = box.left
        if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - width)
        let top = box.bottom + 8
        if (top + 96 > window.innerHeight) top = Math.max(8, box.top - 8 - 96)
        setMenuPos({ top, left, width })
      }
      place()
      const onDown = (event) => {
        const root = modelRootRef.current
        const menu = event.target && event.target.closest ? event.target.closest('[data-dar-ms-menu]') : null
        if (menu) return
        if (root && event.target && root.contains(event.target)) return
        closeModelMenu()
      }
      window.addEventListener('resize', place)
      document.addEventListener('mousedown', onDown)
      return () => {
        window.removeEventListener('resize', place)
        document.removeEventListener('mousedown', onDown)
      }
    }, [modelOpen, modelPane])

    React.useEffect(() => {
      if (!pickOpen) {
        setPickPos(null)
        return undefined
      }
      if (pickOpen === 'file' && tab !== 'persona') {
        setPickOpen('')
        setPickPos(null)
        return undefined
      }
      const place = () => {
        const root = pickOpen === 'agent' ? agentPickRef.current : filePickRef.current
        if (!root || typeof root.getBoundingClientRect !== 'function') return
        const box = root.getBoundingClientRect()
        const width = Math.min(360, Math.max(218, box.width))
        let left = box.left
        if (left + width > window.innerWidth - 12) left = Math.max(12, window.innerWidth - 12 - width)
        const count = pickOpen === 'file' ? coreFiles(dailyMeta).length : Math.max(1, choices.length)
        const height = Math.min(360, 8 + 40 * count)
        let top = box.bottom + 4
        if (top + height > window.innerHeight - 12) top = Math.max(12, box.top - 4 - height)
        setPickPos({ top, left, width })
      }
      place()
      const onDown = (event) => {
        const menu = event.target && event.target.closest ? event.target.closest('[data-dar-pick-menu]') : null
        if (menu) return
        const root = pickOpen === 'agent' ? agentPickRef.current : filePickRef.current
        if (root && event.target && root.contains(event.target)) return
        setPickOpen('')
        setPickPos(null)
      }
      const onKey = (event) => {
        if (event.key === 'Escape') {
          setPickOpen('')
          setPickPos(null)
        }
      }
      window.addEventListener('resize', place)
      window.addEventListener('scroll', place, true)
      document.addEventListener('pointerdown', onDown)
      document.addEventListener('keydown', onKey)
      return () => {
        window.removeEventListener('resize', place)
        window.removeEventListener('scroll', place, true)
        document.removeEventListener('pointerdown', onDown)
        document.removeEventListener('keydown', onKey)
      }
    }, [pickOpen, tab, choices.length])

    React.useEffect(() => {
      post('/dsh-agent-registry/models', {}).then((data) => {
        if (data && data.ok === true) {
          setCatalog({ official: data.official || null, groups: Array.isArray(data.groups) ? data.groups : [] })
        }
      }).catch(() => setCatalog({ official: null, groups: [] }))
    }, [tab])

    React.useEffect(() => {
      fetch('/dsh-skill-manager/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DSH-Skill-Manager': '1' },
        body: '{}',
      }).then((res) => res.json()).then((data) => {
        if (data && data.ok === true && Array.isArray(data.items)) setSkillItems(data.items)
      }).catch(() => setSkillItems([]))
    }, [])

    function saveModel(selection) {
      if (!current) return
      setModelBusy(true)
      post('/dsh-agent-registry/model', {
        agentId: current.agentId,
        inherit: selection == null,
        model: selection,
      }).then(() => {
        toast(t('saved'))
        return load()
      }).catch((err) => toast(String(err.message || t('fail')))).finally(() => setModelBusy(false))
    }

    function savePolicy() {
      if (!current || !policy) return
      setPolicyBusy(true)
      post('/dsh-agent-registry/policy', { agentId: current.agentId, policy }).then(() => {
        toast(t('saved'))
        return load()
      }).catch((err) => toast(String(err.message || t('fail')))).finally(() => setPolicyBusy(false))
    }

    function permField(label, control, span) {
      return el('div', { className: 'dar-perm-item', 'data-span': span ? '2' : undefined },
        el('div', { className: 'dar-perm-k' }, label),
        control,
      )
    }

    function segs(value, options, onChange) {
      return el('div', { className: 'dar-segs' }, options.map((opt) => el('button', {
        key: opt.id,
        type: 'button',
        className: 'dar-seg',
        'data-on': value === opt.id ? 'true' : undefined,
        disabled: !!opt.disabled,
        onClick() { if (!opt.disabled) onChange(opt.id) },
      }, opt.label)))
    }

    function faceOptions(face, ids, labels) {
      const cap = clawHardCap()
      return ids.map((id) => ({
        id,
        label: labels[id],
        disabled: !optionAllowed(cap, face, id),
      }))
    }

    function permissionsPanel() {
      const currentPolicy = policy || clampClawPolicy(normalizePolicy(agent && (agent.policy || agent.declared), agent && agent.preset))
      const cap = clawHardCap()
      return el('div', { className: 'dar-panel-body' },
        el('div', { className: 'dar-perm-grid' },
          permField(t('preset'), segs(currentPolicy.preset, AGENT_PRESET_IDS.map((id) => ({ id, label: t('preset_' + id) })), (id) => {
            setPolicy(clampClawPolicy(applyPreset(id)))
          }), true),
          permField(t('filesRead'), segs(currentPolicy.files.read, faceOptions('files.read', ['none', 'workspace', 'all'], {
            none: t('permNone'),
            workspace: t('permWorkspace'),
            all: t('permAll'),
          }), (id) => setPolicy(clampClawPolicy({ ...currentPolicy, files: { ...currentPolicy.files, read: id } })))),
          permField(t('filesWrite'), segs(currentPolicy.files.write, faceOptions('files.write', ['none', 'workspace', 'all'], {
            none: t('permNone'),
            workspace: t('permWorkspace'),
            all: t('permAll'),
          }), (id) => setPolicy(clampClawPolicy({ ...currentPolicy, files: { ...currentPolicy.files, write: id } })))),
          permField(t('shell'), segs(currentPolicy.shell, faceOptions('shell', ['deny', 'allowlist', 'allow'], {
            deny: t('permDeny'),
            allowlist: t('permAllowlist'),
            allow: t('permAllow'),
          }), (id) => setPolicy(clampClawPolicy({ ...currentPolicy, shell: id })))),
          permField(t('approval'), segs(currentPolicy.approval, faceOptions('approval', ['never', 'ask-external', 'ask-always'], {
            never: t('permNever'),
            'ask-external': t('permAskExternal'),
            'ask-always': t('permAskAlways'),
          }), (id) => setPolicy(clampClawPolicy({ ...currentPolicy, approval: id })))),
          permField(t('mcp'), segs(currentPolicy.mcp, faceOptions('mcp', ['none', 'explicit', 'init-defaults'], {
            none: t('permMcpNone'),
            explicit: t('permMcpExplicit'),
            'init-defaults': t('permMcpInit'),
          }), (id) => setPolicy(clampClawPolicy({ ...currentPolicy, mcp: id })))),
          currentPolicy.mcp === 'explicit' ? permField(t('mcpAllow'), el('input', {
            className: 'dar-perm-num',
            value: ((currentPolicy.servers && currentPolicy.servers.allow) || []).join(', '),
            placeholder: t('mcpAllowHint'),
            onChange(e) {
              setPolicy(clampClawPolicy({
                ...currentPolicy,
                servers: { ...(currentPolicy.servers || { deny: [] }), allow: String(e.target.value || '').split(/[,;\s]+/).map((item) => item.trim()).filter(Boolean) },
              }))
            },
          })) : null,
          permField(t('delegation'), el('input', {
            className: 'dar-perm-num',
            type: 'number',
            min: 0,
            max: cap.delegation.maxDepth,
            value: currentPolicy.delegation.maxDepth,
            onChange(e) {
              setPolicy(clampClawPolicy({ ...currentPolicy, delegation: { ...currentPolicy.delegation, maxDepth: e.target.value } }))
            },
          })),
          permField(t('tools'), el('div', { className: 'dar-cards' }, TOOL_IDS.map((id) => {
            const locked = !isToolEnabled(cap, id)
            const on = isToolEnabled(currentPolicy, id)
            return el('button', {
              key: id,
              type: 'button',
              className: 'dar-tile',
              'data-on': on ? 'true' : 'false',
              disabled: locked,
              onClick() {
                if (locked) return
                setPolicy(clampClawPolicy(toggleTool(currentPolicy, id, !on)))
              },
            },
              el('span', { className: 'dar-tile-lead' },
                el('span', { className: 'dar-tile-title' }, t('tool_' + id)),
                el('span', {
                  className: 'dar-hint',
                  tabIndex: 0,
                  'data-tip': t('toolhint_' + id),
                  'aria-label': t('toolhint_' + id),
                  onClick(e) { e.preventDefault(); e.stopPropagation() },
                  onKeyDown(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation() } },
                }, '!'),
              ),
              el('span', { className: 'dar-tag', 'data-on': on ? 'true' : 'false' }, on ? t('skillOn') : t('skillOff')),
            )
          })), true),
        ),
        el('button', {
          type: 'button',
          className: 'dar-btn',
          disabled: policyBusy || !current,
          onClick: savePolicy,
        }, t('savePolicy')),
      )
    }

    function saveSkills(nextDeny) {
      if (!current) return
      setSkillBusy(true)
      post('/dsh-agent-registry/skills', { agentId: current.agentId, deny: nextDeny }).then(() => {
        setSkillDeny(nextDeny)
        return load()
      }).catch((err) => toast(String(err.message || t('fail')))).finally(() => setSkillBusy(false))
    }

    function skillsPanel() {
      const denied = new Set(skillDeny)
      return el('div', { className: 'dar-panel-body' },
        skillItems.length === 0
          ? el('p', { className: 'dar-empty' }, t('skillsEmpty'))
          : el('div', { className: 'dar-cards' }, skillItems.map((item) => {
            const on = !denied.has(item.name)
            return el('button', {
              key: item.name,
              type: 'button',
              className: 'dar-tile',
              'data-on': on ? 'true' : 'false',
              disabled: skillBusy || !current,
              title: item.description || item.name,
              onClick() {
                const next = on
                  ? skillDeny.concat([item.name]).filter((name, index, list) => list.indexOf(name) === index)
                  : skillDeny.filter((name) => name !== item.name)
                saveSkills(next)
              },
            },
              el('span', { className: 'dar-tile-title' }, item.name),
              el('span', { className: 'dar-tag', 'data-on': on ? 'true' : 'false' }, on ? t('skillOn') : t('skillOff')),
            )
          })),
      )
    }

    const panel = tab === 'persona' ? personaPanel()
      : tab === 'memory' ? memoryPanel()
        : tab === 'model' ? modelPanel()
          : tab === 'permissions' ? permissionsPanel()
            : tab === 'skills' ? skillsPanel()
              : overviewPanel()

    return el('div', { className: 'dar-page' },
      el('h2', { className: 'dar-title' }, t('title')),
      error ? el('p', { className: 'dar-note' }, error) : null,
      el('div', { className: 'dar-toolbar' },
        el('div', { className: 'dar-pick-wrap dar-pick-toolbar' },
          pickTrigger(
            agentPickRef,
            'agent',
            current ? current.label : '',
            t('selectAgent'),
            choices.length === 0,
          ),
          pickOpen === 'agent'
            ? pickMenu(choices.map((row) => ({ id: row.agentId, label: row.label })), current && current.agentId, setSelected)
            : null,
        ),
        el('div', { className: 'dar-toolbar-actions' },
          el('button', { type: 'button', className: 'dar-btn', onClick: copyId, disabled: !current }, t('copyId')),
          el('button', { type: 'button', className: 'dar-btn', onClick: load }, t('refresh')),
          current && !isMain && agent && agent.status === 'archived'
            ? el('button', { type: 'button', className: 'dar-btn', disabled: busy, onClick() { act('/dsh-agent-registry/restore') } }, t('restore'))
            : null,
          current && !isMain && agent && agent.status !== 'archived'
            ? el('button', { type: 'button', className: 'dar-btn dar-danger', disabled: busy, onClick() { closePick(); setConfirm(true) } }, t('archive'))
            : null,
        ),
      ),
      choices.length === 0
        ? el('p', { className: 'dar-empty' }, t('empty'))
        : el(React.Fragment, null,
          el('div', { className: 'dar-tabs', role: 'tablist', 'aria-label': t('tabs') },
            TABS.map((id) => el('button', {
              key: id,
              type: 'button',
              role: 'tab',
              className: 'dar-tab',
              'aria-selected': tab === id ? 'true' : 'false',
              'data-active': tab === id ? 'true' : undefined,
              onClick() { setTab(id) },
            }, t('tab' + id.charAt(0).toUpperCase() + id.slice(1)))),
          ),
          el('div', { className: 'dar-card', role: 'tabpanel' }, panel),
        ),
      confirm ? el('div', { className: 'dar-overlay', onClick() { setConfirm(false) } },
        el('div', { className: 'dar-dialog', onClick(e) { e.stopPropagation() } },
          el('div', { className: 'dar-dialog-head' }, t('archiveTitle')),
          el('div', { className: 'dar-dialog-body' }, t('archiveBody')),
          el('div', { className: 'dar-dialog-actions' },
            el('button', { type: 'button', className: 'dar-btn', onClick() { setConfirm(false) } }, t('cancel')),
            el('button', {
              type: 'button',
              className: 'dar-btn dar-danger',
              disabled: busy,
              onClick() { act('/dsh-agent-registry/archive') },
            }, t('confirm')),
          ),
        ),
      ) : null,
      resetConfirm ? el('div', { className: 'dar-overlay', onClick() { setResetConfirm(false) } },
        el('div', { className: 'dar-dialog', onClick(e) { e.stopPropagation() } },
          el('div', { className: 'dar-dialog-head' }, t('resetTitle', { file: coreSpec(coreFile, dailyMeta).file })),
          el('div', { className: 'dar-dialog-body' }, t('resetBody')),
          el('div', { className: 'dar-dialog-actions' },
            el('button', { type: 'button', className: 'dar-btn', onClick() { setResetConfirm(false) } }, t('cancel')),
            el('button', {
              type: 'button',
              className: 'dar-btn dar-danger',
              disabled: personaBusy,
              onClick: resetCoreFile,
            }, t('resetConfirm')),
          ),
        ),
      ) : null,
    )
  }
}

export function registerSettings(ctx, React, t, Page) {
  const slots = ctx.get('slots')
  if (slots == null || React == null) return function () {}
  return slots.inject('settings.section', function () {
    return slots.register({
      name: 'settings.section',
      id: 'dsh-agent-registry',
      order: 19,
      locale: NS,
      label() { return t('nav') },
    }, Page)
  })
}
