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
import { effortLabel, findCatalogModel, normalizeModel } from './registry-model.mjs'

const TEMPLATE_TABS = ['persona', 'memory', 'model', 'permissions', 'skills']

const CORE = [
  { key: 'agents', file: 'AGENTS.md' },
  { key: 'soul', file: 'SOUL.md' },
  { key: 'tools', file: 'TOOLS.md' },
  { key: 'identity', file: 'IDENTITY.md' },
  { key: 'user', file: 'USER.md' },
  { key: 'heartbeat', file: 'HEARTBEAT.md' },
  { key: 'bootstrap', file: 'BOOTSTRAP.md' },
]

function svgIcon(el, className, d) {
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

function seedsToPersona(seeds, stock) {
  const src = seeds || {}
  const base = stock || {}
  const pick = (file) => (src[file] != null ? src[file] : (base[file] || ''))
  return {
    agents: pick('AGENTS.md'),
    soul: pick('SOUL.md'),
    tools: pick('TOOLS.md'),
    identity: pick('IDENTITY.md'),
    user: pick('USER.md'),
    heartbeat: pick('HEARTBEAT.md'),
    bootstrap: pick('BOOTSTRAP.md'),
  }
}

export function createTemplatePage(React, t, post, toast, subscribeLocale, ReactDOM) {
  return function TemplatePage() {
    const el = React.createElement
    const [, setLocaleTick] = React.useState(0)
    React.useEffect(() => {
      if (typeof subscribeLocale !== 'function') return undefined
      return subscribeLocale(() => setLocaleTick((n) => n + 1))
    }, [subscribeLocale])

    const [data, setData] = React.useState(null)
    const [error, setError] = React.useState('')
    const [tab, setTab] = React.useState('permissions')
    const [busy, setBusy] = React.useState(false)
    const [persona, setPersona] = React.useState(seedsToPersona())
    const [personaSaved, setPersonaSaved] = React.useState(seedsToPersona())
    const [coreFile, setCoreFile] = React.useState('soul')
    const [resetConfirm, setResetConfirm] = React.useState(false)
    const [policy, setPolicy] = React.useState(null)
    const [catalog, setCatalog] = React.useState({ official: null, groups: [] })
    const [skillItems, setSkillItems] = React.useState([])
    const [modelOpen, setModelOpen] = React.useState(false)
    const [modelPane, setModelPane] = React.useState('root')
    const [menuPos, setMenuPos] = React.useState(null)
    const [pickOpen, setPickOpen] = React.useState(false)
    const [pickPos, setPickPos] = React.useState(null)
    const [vault, setVault] = React.useState(null)
    const modelRootRef = React.useRef(null)
    const filePickRef = React.useRef(null)

    const template = (data && data.template) || { preset: 'research', mcp: 'init-defaults', policy: null, model: null, skills: { deny: [] } }

    const load = React.useCallback(() => {
      return post('/dsh-agent-registry/list', {}).then((next) => {
        setData(next)
        setError('')
        const row = next && next.template
        const nextPersona = seedsToPersona(row && row.seeds, row && row.stockSeeds)
        setPersona(nextPersona)
        setPersonaSaved(nextPersona)
        setPolicy(clampClawPolicy(normalizePolicy((row && row.policy) || row, row && row.preset)))
      }).catch((err) => {
        setError(String(err.message || err))
      })
    }, [])

    React.useEffect(() => { load() }, [load])

    React.useEffect(() => {
      post('/dsh-agent-registry/models', {}).then((row) => {
        if (row && row.ok === true) setCatalog({ official: row.official || null, groups: Array.isArray(row.groups) ? row.groups : [] })
      }).catch(() => setCatalog({ official: null, groups: [] }))
    }, [tab])

    React.useEffect(() => {
      fetch('/dsh-skill-manager/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DSH-Skill-Manager': '1' },
        body: '{}',
      }).then((res) => res.json()).then((row) => {
        if (row && row.ok === true && Array.isArray(row.items)) setSkillItems(row.items)
      }).catch(() => setSkillItems([]))
    }, [])

    React.useEffect(() => {
      fetch('/dsh-agent-memory/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DSH-Agent-Memory': '1' },
        body: '{}',
      }).then((res) => res.json()).then((row) => {
        if (row && row.ok === true) setVault({ settings: row.settings })
      }).catch(() => {})
    }, [])

    function saveTemplate(patch) {
      setBusy(true)
      return post('/dsh-agent-registry/template', patch).then((next) => {
        if (next && next.template) {
          setData((prev) => ({ ...(prev || {}), template: next.template }))
          setPolicy(clampClawPolicy(normalizePolicy(next.template.policy || next.template, next.template.preset)))
        }
        toast(t('saved'))
        return next
      }).catch((err) => {
        toast(String(err.message || t('fail')))
      }).finally(() => setBusy(false))
    }

    function saveMemSettings(next) {
      fetch('/dsh-agent-memory/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DSH-Agent-Memory': '1' },
        body: JSON.stringify({ settings: next }),
      }).then((res) => res.json()).then((row) => {
        if (!row || row.ok !== true) {
          toast((row && row.error) || t('fail'))
          return
        }
        setVault({ settings: row.settings })
        toast(t('saved'))
      }).catch(() => toast(t('fail')))
    }

    function specOf(key) {
      return CORE.find((row) => row.key === key) || CORE[0]
    }

    function segs(value, options, onChange) {
      return el('div', { className: 'dar-segs' }, options.map((opt) => el('button', {
        key: opt.id,
        type: 'button',
        className: 'dar-seg',
        'data-on': value === opt.id ? 'true' : undefined,
        disabled: !!opt.disabled || busy,
        onClick() { if (!opt.disabled) onChange(opt.id) },
      }, opt.label)))
    }

    function permField(label, control, span) {
      return el('div', { className: 'dar-perm-item', 'data-span': span ? '2' : undefined },
        el('div', { className: 'dar-perm-k' }, label),
        control,
      )
    }

    function faceOptions(face, ids, labels) {
      const cap = clawHardCap()
      return ids.map((id) => ({
        id,
        label: labels[id],
        disabled: !optionAllowed(cap, face, id),
      }))
    }

    const currentPolicy = policy || clampClawPolicy(normalizePolicy(template.policy || template, template.preset))

    function personaPanel() {
      const spec = specOf(coreFile)
      const dirty = persona[spec.key] !== personaSaved[spec.key]
      return el('div', { className: 'dar-panel-body' },
        el('div', { className: 'dar-pick-wrap dar-pick-block' },
          el('button', {
            type: 'button',
            ref: filePickRef,
            className: 'dar-pick',
            'aria-haspopup': 'menu',
            'aria-expanded': pickOpen ? 'true' : 'false',
            onClick() { setPickOpen((on) => !on) },
          },
            el('span', { className: 'dar-pick-label' }, spec.file),
            svgIcon(el, 'dar-pick-chevron' + (pickOpen ? ' is-open' : ''), 'M3 5l4 4 4-4'),
          ),
          pickOpen && pickPos ? (function () {
            const menu = el('div', {
              className: 'dar-ms-menu',
              role: 'menu',
              'data-dar-pick-menu': 'file',
              style: { top: pickPos.top + 'px', left: pickPos.left + 'px', width: pickPos.width + 'px' },
            }, CORE.map((row) => el('button', {
              key: row.key,
              type: 'button',
              role: 'menuitem',
              className: 'dar-ms-option' + (row.key === coreFile ? ' is-on' : ''),
              onClick() { setCoreFile(row.key); setPickOpen(false) },
            }, el('span', { className: 'dar-ms-option-name' }, row.file))))
            if (ReactDOM && typeof ReactDOM.createPortal === 'function' && typeof document !== 'undefined') {
              return ReactDOM.createPortal(menu, document.body)
            }
            return menu
          }()) : null,
        ),
        el('textarea', {
          className: 'dar-textarea-core',
          value: persona[spec.key] || '',
          onChange(e) { setPersona((prev) => ({ ...prev, [spec.key]: e.target.value })) },
        }),
        el('div', { className: 'dar-file-actions' },
          el('button', {
            type: 'button',
            className: 'dar-btn',
            disabled: busy || !dirty,
            onClick() {
              saveTemplate({ seed: { file: spec.file, content: persona[spec.key] } }).then(() => {
                setPersonaSaved((prev) => ({ ...prev, [spec.key]: persona[spec.key] }))
              })
            },
          }, t('saveFile')),
          el('button', {
            type: 'button',
            className: 'dar-btn',
            disabled: busy,
            onClick() { setResetConfirm(true) },
          }, t('resetFile')),
        ),
      )
    }

    function memoryPanel() {
      const settings = (vault && vault.settings) || { writeApproval: false, review: { enabled: true } }
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
      )
    }

    function closeModelMenu() {
      setModelOpen(false)
      setModelPane('root')
    }

    function modelPanel() {
      const pinned = normalizeModel(template.model)
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
          el('div', { className: 'dar-ms', ref: modelRootRef, 'data-dar-ms': '1' },
            el('button', {
              type: 'button',
              className: 'dar-ms-trigger',
              disabled: busy,
              'aria-haspopup': 'menu',
              'aria-expanded': modelOpen ? 'true' : 'false',
              onClick() {
                if (modelOpen) closeModelMenu()
                else { setModelPane('root'); setModelOpen(true) }
              },
            },
              el('span', { className: 'dar-ms-trigger-label' }, modelLabel || t('modelFallback')),
              effortText ? el('span', { className: 'dar-ms-trigger-effort' }, effortText) : null,
              svgIcon(el, 'dar-ms-chevron' + (modelOpen ? ' is-open' : ''), 'M3 5l4 4 4-4'),
            ),
            (function () {
              if (!modelOpen || !menuPos) return null
              const menu = el('div', {
                className: 'dar-ms-menu',
                role: 'menu',
                'data-dar-ms-menu': '1',
                style: { top: menuPos.top + 'px', left: menuPos.left + 'px', width: menuPos.width + 'px' },
              },
                modelPane === 'root' ? el(React.Fragment, null,
                  el('button', { type: 'button', className: 'dar-ms-cell', onClick() { setModelPane('model') } },
                    el('span', { className: 'dar-ms-cell-label' }, t('modelRow')),
                    el('span', { className: 'dar-ms-cell-value' }, modelLabel),
                    svgIcon(el, 'dar-ms-cell-chevron', 'M5 3l4 4-4 4'),
                  ),
                ) : null,
                modelPane === 'model' ? el('div', { className: 'dar-ms-groups' },
                  el('button', {
                    type: 'button',
                    className: 'dar-ms-option' + (inherit ? ' is-on' : ''),
                    onClick() { saveTemplate({ inheritModel: true }); closeModelMenu() },
                  }, el('span', { className: 'dar-ms-option-name' }, t('modelInherit'))),
                  (catalog.groups || []).map((group) => el('section', { key: group.id, className: 'dar-ms-group' },
                    el('div', { className: 'dar-ms-group-title' }, group.name || group.id),
                    (group.models || []).map((item) => el('button', {
                      key: item.id,
                      type: 'button',
                      className: 'dar-ms-option',
                      onClick() {
                        const next = { provider: group.id, model: item.id }
                        if (item.reasoning && item.reasoning.defaultEffort) next.reasoningEffort = item.reasoning.defaultEffort
                        saveTemplate({ model: next })
                        closeModelMenu()
                      },
                    }, el('span', { className: 'dar-ms-option-name' }, item.name || item.id))),
                  )),
                  empty ? el('div', { className: 'dar-ms-empty' }, t('modelEmpty')) : null,
                ) : null,
              )
              if (ReactDOM && typeof ReactDOM.createPortal === 'function' && typeof document !== 'undefined') {
                return ReactDOM.createPortal(menu, document.body)
              }
              return menu
            }()),
          ),
        ),
      )
    }

    function permissionsPanel() {
      const cap = clawHardCap()
      return el('div', { className: 'dar-panel-body' },
        el('div', { className: 'dar-perm-grid' },
          permField(t('preset'), segs(currentPolicy.preset, AGENT_PRESET_IDS.map((id) => ({ id, label: t('preset_' + id) })), (id) => {
            setPolicy(clampClawPolicy(applyPreset(id)))
          }), true),
          permField(t('filesRead'), segs(currentPolicy.files.read, faceOptions('files.read', ['none', 'workspace', 'all'], {
            none: t('permNone'), workspace: t('permWorkspace'), all: t('permAll'),
          }), (id) => setPolicy(clampClawPolicy({ ...currentPolicy, files: { ...currentPolicy.files, read: id } })))),
          permField(t('filesWrite'), segs(currentPolicy.files.write, faceOptions('files.write', ['none', 'workspace', 'all'], {
            none: t('permNone'), workspace: t('permWorkspace'), all: t('permAll'),
          }), (id) => setPolicy(clampClawPolicy({ ...currentPolicy, files: { ...currentPolicy.files, write: id } })))),
          permField(t('shell'), segs(currentPolicy.shell, faceOptions('shell', ['deny', 'allowlist', 'allow'], {
            deny: t('permDeny'), allowlist: t('permAllowlist'), allow: t('permAllow'),
          }), (id) => setPolicy(clampClawPolicy({ ...currentPolicy, shell: id })))),
          permField(t('approval'), segs(currentPolicy.approval, faceOptions('approval', ['never', 'ask-external', 'ask-always'], {
            never: t('permNever'), 'ask-external': t('permAskExternal'), 'ask-always': t('permAskAlways'),
          }), (id) => setPolicy(clampClawPolicy({ ...currentPolicy, approval: id })))),
          permField(t('mcp'), segs(currentPolicy.mcp, faceOptions('mcp', ['none', 'explicit', 'init-defaults'], {
            none: t('permMcpNone'), explicit: t('permMcpExplicit'), 'init-defaults': t('permMcpInit'),
          }), (id) => setPolicy(clampClawPolicy({ ...currentPolicy, mcp: id })))),
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
              disabled: locked || busy,
              onClick() {
                if (locked) return
                setPolicy(clampClawPolicy(toggleTool(currentPolicy, id, !on)))
              },
            },
              el('span', { className: 'dar-tile-title' }, t('tool_' + id)),
              el('span', { className: 'dar-tag', 'data-on': on ? 'true' : 'false' }, on ? t('skillOn') : t('skillOff')),
            )
          })), true),
        ),
        el('button', {
          type: 'button',
          className: 'dar-btn',
          disabled: busy,
          onClick() { saveTemplate({ policy: currentPolicy, preset: currentPolicy.preset, mcp: currentPolicy.mcp, servers: currentPolicy.servers }) },
        }, t('savePolicy')),
      )
    }

    function skillsPanel() {
      const denied = new Set(((template.skills && template.skills.deny) || []))
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
              disabled: busy,
              onClick() {
                const next = on
                  ? ((template.skills && template.skills.deny) || []).concat([item.name])
                  : ((template.skills && template.skills.deny) || []).filter((name) => name !== item.name)
                saveTemplate({ skills: { deny: next } })
              },
            },
              el('span', { className: 'dar-tile-title' }, item.name),
              el('span', { className: 'dar-tag', 'data-on': on ? 'true' : 'false' }, on ? t('skillOn') : t('skillOff')),
            )
          })),
      )
    }

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
        setMenuPos({ top: box.bottom + 8, left, width })
      }
      place()
      const onDown = (event) => {
        if (event.target && event.target.closest && event.target.closest('[data-dar-ms-menu]')) return
        const root = modelRootRef.current
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
      const place = () => {
        const root = filePickRef.current
        if (!root || typeof root.getBoundingClientRect !== 'function') return
        const box = root.getBoundingClientRect()
        setPickPos({ top: box.bottom + 4, left: box.left, width: Math.max(218, box.width) })
      }
      place()
      const onDown = (event) => {
        if (event.target && event.target.closest && event.target.closest('[data-dar-pick-menu]')) return
        setPickOpen(false)
      }
      document.addEventListener('pointerdown', onDown)
      return () => document.removeEventListener('pointerdown', onDown)
    }, [pickOpen])

    const panel = tab === 'persona' ? personaPanel()
      : tab === 'memory' ? memoryPanel()
        : tab === 'model' ? modelPanel()
          : tab === 'skills' ? skillsPanel()
            : permissionsPanel()

    const stock = (template.stockSeeds || {})
    const spec = specOf(coreFile)

    return el('div', { className: 'dar-page' },
      el('h2', { className: 'dar-title' }, t('tabTemplate')),
      error ? el('p', { className: 'dar-note' }, error) : null,
      el('div', { className: 'dar-tabs', role: 'tablist', 'aria-label': t('tabs') },
        TEMPLATE_TABS.map((id) => el('button', {
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
      resetConfirm ? el('div', { className: 'dar-overlay', onClick() { setResetConfirm(false) } },
        el('div', { className: 'dar-dialog', onClick(e) { e.stopPropagation() } },
          el('div', { className: 'dar-dialog-head' }, t('resetTitle', { file: spec.file })),
          el('div', { className: 'dar-dialog-body' }, t('resetBody')),
          el('div', { className: 'dar-dialog-actions' },
            el('button', { type: 'button', className: 'dar-btn', onClick() { setResetConfirm(false) } }, t('cancel')),
            el('button', {
              type: 'button',
              className: 'dar-btn dar-danger',
              disabled: busy,
              onClick() {
                const text = stock[spec.file] || ''
                saveTemplate({ seed: { file: spec.file, content: text } }).then(() => {
                  setPersona((prev) => ({ ...prev, [spec.key]: text }))
                  setPersonaSaved((prev) => ({ ...prev, [spec.key]: text }))
                  setResetConfirm(false)
                })
              },
            }, t('resetConfirm')),
          ),
        ),
      ) : null,
    )
  }
}
