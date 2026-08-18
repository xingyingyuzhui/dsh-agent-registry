import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { agentIdForWorkspace, emptyRegistry, ensureBinding, loadRegistry, saveRegistry, setAgentModel, setAgentPolicy, setAgentSkills } from '../registry-store.mjs'
import {
  clearClawDefault,
  applyPreset,
  declaredOf,
  ensureGeneratedPreset,
  isToolEnabled,
  toggleTool,
  ensureTemplateNamed,
  openPersonaYaml,
  INIT_PRESET,
  fallbackMissingPreset,
  isClawPresetId,
  presetIdForWorkspace,
  rewriteTemplatePresetYaml,
  TEMPLATE_NAME,
} from '../registry-presets.mjs'
import { archiveAgent, explainAgent, listProjected, renameAgent, restoreAgent, sameRoot, syncBindings } from '../registry-logic.mjs'
import { CLAW_SESSION_ATTR, PRESET_HIDE_ATTR, WORKSPACE_HIDE_ATTR, hideClawPresetSurfaces, hideClawSessionSeat, inProtectedChrome, isAccessSeatButton, isAccessMenuItem, isPresetSeatButton, isWorkspaceSeatButton } from '../registry-preset-hide.mjs'
import { bindCreatedAgent, isClawHomePath, isStockAgentsSeed, purgeLegacyAgents, refreshSeedFiles, rewriteIdentityHeading, seedFiles, seedNeedsRefresh, slugFromName } from '../registry-claw.mjs'
import {
  agentForSession,
  nextPresetBind,
  clawAgents,
  clawHideKeys,
  clawHideNames,
  clawPresetIds,
  isClawWorkspaceFact,
  isDsClawPath,
  defaultZone,
  detectClawZone,
  filterClawSearch,
  isClawPresetMenuLabel,
  isOfficialSectionLabel,
  normalizeZone,
  resolveZone,
  selectableAgents,
  sessionStamp,
  shouldHideOfficialGroup,
} from '../registry-view.mjs'
import { applyClawHeaderActions, applyClawSearchInput, applyOfficialSearchHide, applyZoneVisibility, CLAW_ACTIONS_ATTR, CLAW_ATTR, findHeaderActions, findOfficialSearchInput, readOfficialSearchQuery, SEARCH_HIDE_ATTR, TREE_HIDE_ATTR, ZONE_HIDE_ATTR } from '../registry-sidebar.mjs'
import {
  filterOfficialPresetRoster,
  isolateWorkspaceSnapshot,
  shouldShowClawRoster,
  wrapPresetList,
  wrapWorkspaceList,
} from '../registry-isolate.mjs'

test('agent ids are stable per workspace id', () => {
  assert.equal(agentIdForWorkspace('abc'), 'wa_abc')
  assert.equal(agentIdForWorkspace('abc'), agentIdForWorkspace('abc'))
})

test('generated DSH preset ids are roster-legal and not the shipped four', () => {
  const id = presetIdForWorkspace('2e263a19-08cd-4274-b2af-42286f96b517')
  assert.match(id, /^[a-z0-9][a-z0-9-]*$/)
  assert.equal(id.startsWith('wa-'), true)
  assert.doesNotMatch(id, /_/)
})

test('claw preset ids are the template and wa-* copies only', () => {
  assert.equal(isClawPresetId('wa-template'), true)
  assert.equal(isClawPresetId('wa-ws-a'), true)
  assert.equal(isClawPresetId('standard'), false)
  assert.equal(isClawPresetId('minimal'), false)
  assert.equal(isClawPresetId('my-agent'), false)
})

test('openPersonaYaml turns complete persona off', () => {
  const src = '    text: hi\n    complete: true\n    includeRuntimeContext: false\n'
  assert.match(openPersonaYaml(src), /complete: false/)
})

test('rewriteTemplatePresetYaml replaces the name field', () => {
  assert.equal(
    rewriteTemplatePresetYaml('name: 工作区 Agent 模板\ndescription: x\n', TEMPLATE_NAME),
    'name: claw区agent模板\ndescription: x\n',
  )
})

test('ensureTemplateNamed rewrites an old template display name', async () => {
  const files = { '/tmp/wa-template/preset.yml': 'name: 工作区 Agent 模板\n' }
  const result = await ensureTemplateNamed({
    async list() {
      return [{ id: 'wa-template', name: '工作区 Agent 模板', path: '/tmp/wa-template/agent.cordis.yml' }]
    },
  }, {
    async readFile(file) { return files[file] },
    async writeFile(file, text) { files[file] = text },
  })
  assert.equal(result.changed, true)
  assert.match(files['/tmp/wa-template/preset.yml'], /claw区agent模板/)
})

test('clearClawDefault unsets only claw roster ids', async () => {
  const ops = []
  const settings = { async mutate(ns, list) { ops.push({ ns, list }) } }
  assert.equal((await clearClawDefault(settings, 'standard')).cleared, false)
  assert.equal((await clearClawDefault(settings, 'wa-ws-a')).cleared, true)
  assert.deepEqual(ops, [{ ns: 'agent-presets', list: [{ op: 'unset', path: ['default'] }] }])
})

test('ensureGeneratedPreset copies template then workspace preset', async () => {
  const copies = []
  const presets = {
    async list() {
      return copies.length === 0
        ? [{ id: 'minimal' }, { id: 'standard' }]
        : [{ id: 'minimal' }, { id: 'standard' }, ...copies.map((row) => ({ id: row.id }))]
    },
    async copy(from, id, name) { copies.push({ from, id, name }) },
  }
  await ensureGeneratedPreset(presets, { id: 'wa-ws1', name: 'One' })
  await ensureGeneratedPreset(presets, { id: 'wa-ws1', name: 'One' })
  assert.deepEqual(copies, [
    { from: 'minimal', id: 'wa-template', name: TEMPLATE_NAME },
    { from: 'wa-template', id: 'wa-ws1', name: 'One' },
  ])
})

test('ensureGeneratedPreset refuses shipped ids', async () => {
  await assert.rejects(
    () => ensureGeneratedPreset({ list: async () => [], copy: async () => {} }, { id: 'standard' }),
    /refusing/,
  )
})

test('ensureBinding reuses the same agent and keeps id when title changes', () => {
  const first = ensureBinding(emptyRegistry('t0'), { id: 'ws1', path: '/tmp/a', title: 'A' }, 't1')
  assert.equal(first.created, true)
  assert.equal(first.agent.preset, INIT_PRESET)
  const second = ensureBinding(first.registry, { id: 'ws1', path: '/tmp/a', title: 'Renamed' }, 't2')
  assert.equal(second.created, false)
  assert.equal(second.agent.agentId, first.agent.agentId)
  assert.equal(second.agent.title, 'Renamed')
})

test('different workspace ids get different agents', () => {
  const a = ensureBinding(emptyRegistry(), { id: 'one', path: '/tmp/one', title: 'one' })
  const b = ensureBinding(a.registry, { id: 'two', path: '/tmp/two', title: 'two' })
  assert.notEqual(a.agent.agentId, b.agent.agentId)
  assert.equal(Object.keys(b.registry.agents).length, 2)
})

test('agent policy faces can be split from the research template', () => {
  const base = applyPreset('research')
  assert.equal(isToolEnabled(base, 'bash'), false)
  const next = toggleTool(base, 'bash', true)
  assert.equal(isToolEnabled(next, 'bash'), true)
  assert.equal(next.files.write, 'none')
})

test('declared research template is read-only and not enforced', () => {
  const declared = declaredOf('research')
  assert.equal(declared.enforced, false)
  assert.equal(declared.files.write, 'none')
  assert.equal(declared.shell, 'deny')
  assert.equal(declared.delegation.maxDepth, 1)
})

test('setAgentPolicy clamps claw agents below danger-full-access', () => {
  const bound = ensureBinding(emptyRegistry(), { id: 'ws', path: '/tmp/w', title: 'W' })
  const wide = {
    preset: 'developer',
    files: { read: 'workspace', write: 'workspace' },
    shell: 'allow',
    tools: { allow: ['read', 'write', 'edit', 'apply_patch', 'bash', 'deploy'], deny: [] },
    delegation: { maxDepth: 8 },
    approval: 'never',
    mcp: 'init-defaults',
  }
  const next = setAgentPolicy(bound.registry, bound.agent.agentId, wide)
  assert.equal(next.agent.policy.shell, 'allowlist')
  assert.equal(isToolEnabled(next.agent.policy, 'deploy'), true)
  assert.notEqual(next.agent.policy.approval, 'never')
  assert.equal(next.agent.policy.delegation.maxDepth, 1)
  const allFiles = setAgentPolicy(next.registry, bound.agent.agentId, {
    ...wide,
    files: { read: 'all', write: 'all' },
  })
  assert.equal(allFiles.agent.policy.files.read, 'all')
  assert.equal(allFiles.agent.policy.files.write, 'all')
  assert.equal(allFiles.agent.policy.shell, 'allowlist')
})

test('setAgentModel stores a route or clears back to inherit', () => {
  const bound = ensureBinding(emptyRegistry(), { id: 'ws', path: '/tmp/w', title: 'W' })
  assert.equal(bound.agent.model, null)
  const set = setAgentModel(bound.registry, bound.agent.agentId, { provider: 'deepseek', model: 'deepseek-chat' })
  assert.deepEqual(set.agent.model, { provider: 'deepseek', model: 'deepseek-chat' })
  const cleared = setAgentModel(set.registry, bound.agent.agentId, null)
  assert.equal(cleared.agent.model, null)
})

test('setAgentSkills stores a deny list on the agent policy', () => {
  const bound = ensureBinding(emptyRegistry(), { id: 'ws', path: '/tmp/w', title: 'W' })
  const next = setAgentSkills(bound.registry, bound.agent.agentId, ['dsh-plugin', 'pdf'])
  assert.deepEqual(next.agent.policy.skills.deny, ['dsh-plugin', 'pdf'])
})

test('renameAgent updates the management title only', () => {
  const bound = ensureBinding(emptyRegistry(), { id: 'ws', path: '/tmp/w', title: 'Old' })
  const next = renameAgent(bound.registry, bound.agent.agentId, 'New')
  assert.equal(next.agent.title, 'New')
  assert.equal(next.oldTitle, 'Old')
  assert.equal(rewriteIdentityHeading('# Old\n\nYou are the Old Claw agent.\n', 'Old', 'New'), '# New\n\nYou are the Old Claw agent.\n')
})

test('archive and restore flip status only', () => {
  const bound = ensureBinding(emptyRegistry(), { id: 'ws', path: '/tmp/w', title: 'W' })
  const archived = archiveAgent(bound.registry, bound.agent.agentId, 't3')
  assert.equal(archived.agent.status, 'archived')
  const restored = restoreAgent(archived.registry, bound.agent.agentId, 't4')
  assert.equal(restored.agent.status, 'active')
})

test('syncBindings refreshes existing claw agents and does not invent new ones', () => {
  const workspaces = [{ id: 'ws', path: '/tmp/dsh-home/DSclaw/one', title: 'One', sessionIds: ['s1'] }]
  const bound = bindCreatedAgent(emptyRegistry(), {
    workspaceId: 'ws',
    slug: 'one',
    path: '/tmp/dsh-home/DSclaw/one',
    title: 'Old',
    dshPreset: 'wa-one',
  })
  const once = syncBindings(bound.registry, workspaces, 't1')
  const twice = syncBindings(once.registry, workspaces, 't2')
  assert.equal(once.created.length, 0)
  assert.equal(once.changed, true)
  assert.equal(twice.changed, false)
  const listed = listProjected(twice.registry, workspaces)
  assert.equal(listed.agents[0].title, 'One')
  assert.equal(listed.agents[0].sessionCount, 1)
  assert.deepEqual(listed.agents[0].sessionIds, ['s1'])
  assert.equal(listed.agents[0].declared.enforced, false)
})

test('explainAgent finds by workspace id and path', () => {
  const workspaces = [{ id: 'ws', path: '/tmp/dsh-home/DSclaw/one', title: 'One', sessionIds: [] }]
  const bound = bindCreatedAgent(emptyRegistry(), {
    workspaceId: 'ws',
    slug: 'one',
    path: '/tmp/dsh-home/DSclaw/one',
    title: 'One',
    dshPreset: 'wa-one',
  })
  assert.equal(explainAgent(bound.registry, workspaces, { workspaceId: 'ws' }).agentId, 'wa_ws')
  assert.equal(explainAgent(bound.registry, workspaces, { path: '/tmp/dsh-home/DSclaw/one' }).canonicalRoot, '/tmp/dsh-home/DSclaw/one')
  assert.equal(explainAgent(bound.registry, workspaces, { agentId: 'missing' }), null)
})

test('two workspaces stay isolated; symlink path still finds the same agent', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dar-acc-'))
  const one = join(home, 'DSclaw', 'one')
  const two = join(home, 'DSclaw', 'two')
  await mkdir(one, { recursive: true })
  await mkdir(two, { recursive: true })
  const first = bindCreatedAgent(emptyRegistry(), {
    workspaceId: 'w1',
    slug: 'one',
    path: one,
    title: 'One',
    dshPreset: 'wa-one',
  })
  const second = bindCreatedAgent(first.registry, {
    workspaceId: 'w2',
    slug: 'two',
    path: two,
    title: 'Two',
    dshPreset: 'wa-two',
  })
  assert.notEqual(first.agent.agentId, second.agent.agentId)
  assert.notEqual(first.agent.canonicalRoot, second.agent.canonicalRoot)
  const workspaces = [
    { id: 'w1', path: one, title: 'One', sessionIds: [] },
    { id: 'w2', path: two, title: 'Two', sessionIds: [] },
  ]
  const alias = join(home, 'alias-one')
  await symlink(one, alias)
  assert.equal(sameRoot(one, alias), true)
  assert.equal(explainAgent(second.registry, workspaces, { path: alias }).agentId, first.agent.agentId)
  assert.equal(explainAgent(second.registry, workspaces, { path: two }).agentId, second.agent.agentId)
})

test('refreshSeedFiles upgrades stock identity to the OpenClaw-style template', () => {
  const stock = '# test1 operating notes\n\nKeep work inside this agent workspace.\n'
  assert.equal(isStockAgentsSeed(stock), true)
  assert.equal(seedNeedsRefresh({ 'AGENTS.md': stock }).agents, true)
  assert.equal(seedNeedsRefresh({ 'AGENTS.md': stock }).heartbeat, true)
  const next = refreshSeedFiles('test1', {
    'AGENTS.md': stock,
    'SOUL.md': '# test1\n\nYou are the test1 Claw agent.\n',
    'IDENTITY.md': '# Identity\n\nName: test1\n',
  })
  assert.match(next['SOUL.md'], /不是通用聊天机器人/)
  assert.match(next['SOUL.md'], /# test1/)
  assert.match(next['IDENTITY.md'], /Claw Agent/)
  assert.match(next['AGENTS.md'], /## 开场/)
  assert.match(next['AGENTS.md'], /权限天花板/)
  assert.match(next['HEARTBEAT.md'], /every: 0/)
  assert.match(next['TOOLS.md'], /不决定工具开不开/)
  assert.match(next['USER.md'], /Prefer 用中文/)
  const customSoul = refreshSeedFiles('test1', { 'SOUL.md': '# test1\n\nKeep the dry humor.\n' })
  assert.match(customSoul['SOUL.md'], /dry humor/)
  assert.doesNotMatch(customSoul['SOUL.md'], /不是通用聊天机器人/)
})

test('claw slugs and legacy purge', () => {
  assert.equal(slugFromName('Research Bot', []), 'research-bot')
  assert.equal(slugFromName('小黄', []), 'claw')
  assert.equal(slugFromName('小黄', ['claw']), 'claw-2')
  assert.equal(isClawHomePath('/Users/qin/.dsh', '/Users/qin/.dsh/DSclaw/demo'), true)
  assert.equal(isClawHomePath('/Users/qin/.dsh', '/Users/qin/DSH'), false)
  const registry = bindCreatedAgent(emptyRegistry(), {
    workspaceId: 'old',
    slug: '',
    path: '/Users/qin/DSH',
    title: 'DSH',
    dshPreset: 'wa-old',
  }).registry
  const purged = purgeLegacyAgents(registry, '/Users/qin/.dsh')
  assert.equal(purged.changed, true)
  assert.equal(purged.removed.length, 1)
  assert.equal(Object.keys(purged.registry.agents).length, 0)
  const seed = seedFiles('demo')
  assert.match(seed['HEARTBEAT.md'], /every: 0/)
  assert.doesNotMatch(seed['HEARTBEAT.md'], /every: 30m/)
})

test('selectableAgents lists claw agents only and marks archived', () => {
  const rows = selectableAgents({
    main: { agentId: 'main' },
    agents: [
      { agentId: 'wa_a', title: 'Alpha', status: 'active' },
      { agentId: 'wa_b', title: 'Beta', status: 'archived' },
    ],
  }, { main: 'main（控制面）', archived: '已归档' })
  assert.equal(rows.length, 2)
  assert.equal(rows[0].agentId, 'wa_a')
  assert.equal(rows[0].kind, 'workspace')
  assert.equal(rows[1].label, 'Beta (已归档)')
})

test('zone helpers and session-to-agent binding', () => {
  assert.equal(normalizeZone('claw'), 'claw')
  assert.equal(normalizeZone('nope'), 'workspace')
  assert.equal(defaultZone(true), 'claw')
  assert.equal(defaultZone(false), 'workspace')
  assert.equal(resolveZone('claw'), 'claw')
  assert.equal(isOfficialSectionLabel('工作区'), true)
  assert.equal(isOfficialSectionLabel('Claw区'), false)
  const projected = {
    agents: [
      {
        agentId: 'wa_a',
        workspaceId: 'a',
        title: 'DSH',
        status: 'active',
        workspacePresent: true,
        dshPreset: 'wa-aaa',
        sessionIds: ['session-1'],
        canonicalRoot: '/tmp/dsh',
      },
    ],
  }
  assert.equal(agentForSession(projected, 'session-1', null).agentId, 'wa_a')
  assert.equal(agentForSession(projected, 'session-x', { cwd: '/tmp/dsh' }).agentId, 'wa_a')
  assert.equal(agentForSession(projected, 'session-x', { cwd: '/tmp/other' }), null)
})

test('session stamps match official workspace calendar labels', () => {
  const t = (key, params) => {
    if (key === 'timeYesterday') return '昨天'
    if (key === 'timeMonthDay') return params.m + '月' + params.d + '日'
    if (key === 'timeYearMonthDay') return params.y + '年' + params.m + '月' + params.d + '日'
    return key
  }
  const now = new Date(2026, 7, 18, 16, 0).getTime()
  assert.equal(sessionStamp(new Date(2026, 7, 18, 14, 20).getTime(), now, t), '14:20')
  assert.equal(sessionStamp(new Date(2026, 7, 17, 9, 0).getTime(), now, t), '昨天')
  assert.equal(sessionStamp(new Date(2026, 7, 12, 9, 0).getTime(), now, t), '8月12日')
  assert.equal(sessionStamp(new Date(2025, 11, 1, 9, 0).getTime(), now, t), '2025年12月1日')
  assert.equal(sessionStamp(0, now, t), '')
})

test('missing claw presets fall back to standard; live and shipped ids stay', () => {
  const live = new Set(['standard', 'code', 'minimal', 'cordis', 'wa-template', 'wa-test1'])
  assert.equal(fallbackMissingPreset('wa-2e263a19-08cd-4274-b2af-42286f96b517', live), 'standard')
  assert.equal(fallbackMissingPreset('wa-test1', live), 'wa-test1')
  assert.equal(fallbackMissingPreset('wa-template', live), 'wa-template')
  assert.equal(fallbackMissingPreset('standard', live), 'standard')
  assert.equal(fallbackMissingPreset('nope', live), 'nope')
  assert.equal(fallbackMissingPreset('', live), '')
  assert.equal(fallbackMissingPreset(undefined, live), undefined)
  assert.equal(fallbackMissingPreset('wa-gone', live, 'minimal'), 'minimal')
})

test('workspace sessions wearing a missing claw preset are reset to standard', () => {
  const live = new Set(['wa-template', 'wa-test1'])
  const official = nextPresetBind({
    row: {
      blank: true,
      cwd: '/Users/qin/DSH',
      agentPreset: 'wa-2e263a19-08cd-4274-b2af-42286f96b517',
    },
    agent: null,
    pending: { workspaceId: 'claw-ws', preset: 'wa-test1' },
    liveIds: live,
  })
  assert.deepEqual(official, { action: 'select', preset: 'standard', pending: null })
  const already = nextPresetBind({
    row: { blank: true, cwd: '/Users/qin/DSH', agentPreset: 'standard' },
    agent: null,
    pending: null,
    liveIds: live,
  })
  assert.equal(already.action, 'idle')
  const claw = nextPresetBind({
    row: { blank: true, cwd: '/Users/qin/.dsh/DSclaw/test1', agentPreset: 'standard' },
    agent: { workspaceId: 'w1', dshPreset: 'wa-test1' },
    pending: null,
    liveIds: live,
  })
  assert.deepEqual(claw, { action: 'select', preset: 'wa-test1', pending: null })
  const missing = nextPresetBind({
    row: { blank: true, cwd: '/Users/qin/.dsh/DSclaw/test1', agentPreset: 'standard' },
    agent: { workspaceId: 'w1', dshPreset: 'wa-missing' },
    pending: null,
    liveIds: live,
  })
  assert.equal(missing.action, 'idle')
})

test('official pickers drop claw roster rows before render', () => {
  const full = {
    result: {
      ok: true,
      value: {
        presets: [
          { id: 'standard', isDefault: true },
          { id: 'code' },
          { id: 'minimal' },
          { id: 'cordis' },
          { id: 'wa-template' },
          { id: 'wa-test1' },
        ],
      },
    },
  }
  const filtered = filterOfficialPresetRoster(full)
  assert.deepEqual(filtered.result.value.presets.map((row) => row.id), [
    'standard', 'code', 'minimal', 'cordis',
  ])
  const state = isolateWorkspaceSnapshot({
    items: [
      { workspaceId: 'official', title: 'DSH', path: '/Users/qin/DSH', sessionIds: ['session-off'] },
      { workspaceId: 'claw', title: 'test1', path: '/Users/qin/.dsh/DSclaw/test1', sessionIds: ['session-claw'] },
    ],
    recentWorkspaceId: 'claw',
    archivedSessionIds: [],
  }, clawHideKeys({ agents: [] }))
  assert.deepEqual(state.items.map((row) => row.workspaceId), ['official'])
  assert.equal(state.recentWorkspaceId, 'official')
  assert.ok(state.archivedSessionIds.indexOf('session-claw') >= 0)
  assert.ok(state.archivedSessionIds.indexOf('session-off') < 0)
  assert.equal(shouldShowClawRoster(), false)
})

test('wrapped preset list never returns claw copies, including settings', async () => {
  const calls = []
  const api = {
    agentPresets: {
      async list(payload) {
        calls.push(payload)
        return {
          result: {
            ok: true,
            value: { presets: [{ id: 'standard' }, { id: 'wa-test1' }] },
          },
        }
      },
    },
  }
  const stop = wrapPresetList(api)
  const isolated = await api.agentPresets.list({})
  assert.deepEqual(isolated.result.value.presets.map((row) => row.id), ['standard'])
  const again = await api.agentPresets.list({})
  assert.deepEqual(again.result.value.presets.map((row) => row.id), ['standard'])
  stop()
  const restored = await api.agentPresets.list({})
  assert.deepEqual(restored.result.value.presets.map((row) => row.id), ['standard', 'wa-test1'])
  assert.equal(calls.length, 3)
})

test('wrapped workspace list never publishes DSclaw rows', () => {
  let snap = {
    items: [
      { workspaceId: 'official', path: '/Users/qin/DSH' },
      { workspaceId: 'claw', path: '/Users/qin/.dsh/DSclaw/test1' },
    ],
    recentWorkspaceId: 'claw',
  }
  const list = {
    getSnapshot() { return snap },
    set(next) { snap = next },
  }
  const stop = wrapWorkspaceList(list, () => clawHideKeys({ agents: [] }))
  assert.deepEqual(snap.items.map((row) => row.workspaceId), ['official'])
  list.set({
    items: [
      { workspaceId: 'official', path: '/Users/qin/DSH' },
      { workspaceId: 'claw2', path: '/Users/qin/.dsh/DSclaw/test2' },
    ],
    recentWorkspaceId: 'claw2',
  })
  assert.deepEqual(snap.items.map((row) => row.workspaceId), ['official'])
  assert.equal(snap.recentWorkspaceId, 'official')
  stop()
})

test('claw helpers hide bound workspaces and preset picker labels', () => {
  const projected = {
    agents: [
      { agentId: 'wa_a', title: 'DSH', status: 'active', workspacePresent: true, dshPreset: 'wa-aaa' },
      { agentId: 'wa_b', title: 'Gone', status: 'archived', workspacePresent: false, dshPreset: 'wa-bbb' },
    ],
  }
  assert.deepEqual(clawAgents(projected).map((row) => row.agentId), ['wa_a'])
  assert.equal(clawPresetIds(projected).has('wa-template'), true)
  assert.equal(clawPresetIds(projected).has('wa-aaa'), true)
  assert.equal(clawHideNames(projected).has('DSH'), true)
  assert.equal(shouldHideOfficialGroup('DSH', clawHideNames(projected)), true)
  assert.equal(shouldHideOfficialGroup('未分组', clawHideNames(projected)), false)
  assert.equal(isDsClawPath('/Users/qin/.dsh/DSclaw/test1'), true)
  assert.equal(isDsClawPath('/Users/qin/DSH'), false)
  const keys = clawHideKeys({
    agents: [{
      title: 'test1', slug: 'test1', status: 'active', workspacePresent: true,
      canonicalRoot: '/Users/qin/.dsh/DSclaw/test1', workspaceId: 'w1',
      sessionIds: ['session-abc'], dshPreset: 'wa-test1',
    }],
  })
  assert.equal(isClawWorkspaceFact({ title: 'test1' }, keys), true)
  assert.equal(isClawWorkspaceFact({ path: '/Users/qin/.dsh/DSclaw/test1' }, keys), true)
  assert.equal(isClawWorkspaceFact({ sessionId: 'session-abc' }, keys), true)
  assert.equal(isClawWorkspaceFact({ title: 'DSH', path: '/Users/qin/DSH' }, keys), false)
  assert.equal(isClawPresetMenuLabel('claw区agent模板 · 自定义', clawHideNames(projected)), true)
  assert.equal(isClawPresetMenuLabel('标准模式', clawHideNames(projected)), false)
  const names = clawHideNames({
    agents: [
      { title: 'test1', slug: 'test1', status: 'active', workspacePresent: true },
      { title: 'test2', slug: 'test2', status: 'active', workspacePresent: true },
    ],
  })
  assert.equal(isClawPresetMenuLabel('test1仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。', names), true)
  assert.equal(isClawPresetMenuLabel('test1\n仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。', names), true)
  assert.equal(isClawPresetMenuLabel('claw区agent模板仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。', names), true)
  assert.equal(isClawPresetMenuLabel('标准模式功能完整的编码 Agent，支持文件编辑、Shell。', names), false)
  assert.equal(isClawPresetMenuLabel('创造模式用于创建自定义 Agent preset。', names), false)
  assert.equal(isClawPresetMenuLabel('test10 其他模式', names), false)
  const clawItem = {
    textContent: 'test1仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent。',
    attrs: {},
    parentElement: { attrs: {}, getAttribute(name) { return this.attrs[name] }, setAttribute(name, value) { this.attrs[name] = value } },
    closest() { return null },
    getAttribute(name) { return this.attrs[name] },
    setAttribute(name, value) { this.attrs[name] = value },
  }
  const officialItem = {
    textContent: '标准模式功能完整的编码 Agent，支持文件编辑、Shell。',
    attrs: {},
    parentElement: { attrs: {}, getAttribute(name) { return this.attrs[name] }, setAttribute(name, value) { this.attrs[name] = value } },
    closest() { return null },
    getAttribute(name) { return this.attrs[name] },
    setAttribute(name, value) { this.attrs[name] = value },
  }
  hideClawPresetSurfaces({
    querySelectorAll(sel) {
      if (sel === 'code' || sel === 'option') return []
      if (sel === '[role="menuitem"]') return [clawItem, officialItem]
      return []
    },
  }, new Set(['wa-test1']), names)
  assert.equal(clawItem.attrs[PRESET_HIDE_ATTR], '1')
  assert.equal(officialItem.attrs[PRESET_HIDE_ATTR], undefined)
})

test('claw zone hides official tree children but keeps the tree box', () => {
  const doc = {
    trees: [],
    claw: null,
    pins: [],
    querySelectorAll(sel) {
      if (sel === '[role="tree"]') return this.trees
      if (sel === '[data-dsa-pin-section]') return this.pins
      return []
    },
    querySelector(sel) {
      if (sel === '[' + CLAW_ATTR + ']') return this.claw
      return null
    },
  }
  const official = {
    attrs: {},
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) },
    getAttribute(name) { return this.attrs[name] },
    setAttribute(name, value) { this.attrs[name] = value },
    removeAttribute(name) { delete this.attrs[name] },
  }
  const claw = {
    attrs: {},
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) },
    getAttribute(name) { return this.attrs[name] },
    setAttribute(name, value) { this.attrs[name] = value },
    removeAttribute(name) { delete this.attrs[name] },
  }
  const tree = {
    attrs: {},
    children: [official, claw],
    getAttribute(name) { return this.attrs[name] },
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) },
    setAttribute(name, value) { this.attrs[name] = value },
    removeAttribute(name) { delete this.attrs[name] },
    closest() { return null },
  }
  official.hasAttribute = function (name) { return name === CLAW_ATTR ? false : Object.prototype.hasOwnProperty.call(this.attrs, name) }
  claw.hasAttribute = function (name) { return name === CLAW_ATTR ? true : Object.prototype.hasOwnProperty.call(this.attrs, name) }
  doc.trees = [tree]
  doc.claw = claw
  applyZoneVisibility(doc, 'claw', { titles: new Set(), slugs: new Set(), paths: new Set(), sessionIds: new Set(), workspaceIds: new Set() })
  assert.equal(tree.hasAttribute(TREE_HIDE_ATTR), false)
  assert.equal(official.getAttribute(TREE_HIDE_ATTR), '1')
  assert.equal(claw.getAttribute(ZONE_HIDE_ATTR), undefined)
})

function mockEl(init) {
  const el = {
    className: '',
    attrs: {},
    parentElement: null,
    children: [],
    getAttribute(name) { return this.attrs[name] || '' },
    setAttribute(name, value) { this.attrs[name] = value },
    removeAttribute(name) { delete this.attrs[name] },
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) },
    closest() { return null },
    querySelector() { return null },
    ...init,
  }
  return el
}

test('claw zone collapses official view-options and add-workspace actions', () => {
  const actions = mockEl({ className: 'WorkspaceBrowser_headerActions__abc' })
  const view = mockEl({
    parentElement: actions,
    getAttribute(name) { return name === 'aria-label' ? '视图选项' : '' },
  })
  const doc = {
    body: mockEl(),
    querySelectorAll(sel) { return sel === 'button' ? [view] : [] },
    querySelector() { return null },
  }
  applyClawHeaderActions(doc, 'claw')
  assert.equal(actions.attrs[CLAW_ACTIONS_ATTR], '1')
  assert.equal(doc.body.attrs['data-dar-zone'], 'claw')
  applyClawHeaderActions(doc, 'workspace')
  assert.equal(actions.attrs[CLAW_ACTIONS_ATTR], undefined)
  assert.equal(doc.body.attrs['data-dar-zone'], 'workspace')
})

test('claw search keeps agents whose name or session title matches', () => {
  const agents = [
    { agentId: 'a1', title: 'test1', slug: 'test1', sessionIds: ['s1', 's2'] },
    { agentId: 'a2', title: 'alpha', slug: 'alpha', sessionIds: ['s3'] },
  ]
  const titles = { s1: '新会话', s2: '你好', s3: '工作区纪要' }
  const none = filterClawSearch(agents, '', (id) => titles[id])
  assert.equal(none.agents.length, 2)
  assert.equal(none.forcedOpen.size, 0)
  const byName = filterClawSearch(agents, 'TEST1', (id) => titles[id])
  assert.equal(byName.agents.length, 1)
  assert.deepEqual(byName.agents[0].sessionIds, ['s1', 's2'])
  assert.equal(byName.forcedOpen.has('a1'), true)
  const bySession = filterClawSearch(agents, '你好', (id) => titles[id])
  assert.equal(bySession.agents.length, 1)
  assert.deepEqual(bySession.agents[0].sessionIds, ['s2'])
  const miss = filterClawSearch(agents, 'workspace-only', (id) => titles[id])
  assert.equal(miss.agents.length, 0)
})

test('claw zone hides official search chrome and rewrites the search placeholder', () => {
  const input = mockEl({
    className: 'searchInput',
    attrs: { placeholder: '搜索会话…' },
    value: 'test',
  })
  const empty = mockEl({ className: 'empty' })
  const tree = mockEl({ className: 'searchTree', children: [] })
  const list = mockEl({ children: [tree, empty] })
  tree.parentElement = list
  empty.parentElement = list
  const doc = {
    body: mockEl(),
    querySelectorAll(sel) {
      if (sel === 'input') return [input]
      if (sel === 'button') return []
      if (sel === '[role="tree"]') return [tree]
      return []
    },
    querySelector() { return null },
  }
  tree.closest = () => null
  assert.equal(findOfficialSearchInput(doc), input)
  assert.equal(readOfficialSearchQuery(doc), 'test')
  applyOfficialSearchHide(doc, 'claw')
  assert.equal(empty.attrs[SEARCH_HIDE_ATTR], '1')
  applyClawSearchInput(doc, 'claw', '搜索 Agent 和会话')
  assert.equal(input.attrs.placeholder, '搜索 Agent 和会话')
  assert.equal(input.attrs['data-dar-search-scope'], 'claw')
  applyClawSearchInput(doc, 'workspace', '')
  assert.equal(input.attrs.placeholder, '搜索会话…')
  applyOfficialSearchHide(doc, 'workspace')
  assert.equal(empty.attrs[SEARCH_HIDE_ATTR], undefined)
})

test('claw zone finds headerActions across Tooltip wrappers, not the plus parent', () => {
  const actions = mockEl({ className: 'WorkspaceBrowser_headerActions__x' })
  const viewTip = mockEl({ className: 'tooltip', parentElement: actions })
  const addTip = mockEl({ className: 'tooltip', parentElement: actions })
  const view = mockEl({
    parentElement: viewTip,
    getAttribute(name) { return name === 'aria-label' ? '视图选项' : '' },
  })
  const add = mockEl({
    parentElement: addTip,
    getAttribute(name) { return name === 'aria-label' ? '添加工作区' : '' },
  })
  const doc = {
    body: mockEl(),
    querySelectorAll(sel) { return sel === 'button' ? [view, add] : [] },
    querySelector() { return null },
  }
  assert.equal(findHeaderActions(doc), actions)
  applyClawHeaderActions(doc, 'claw')
  assert.equal(actions.attrs[CLAW_ACTIONS_ATTR], '1')
  assert.equal(add.attrs[CLAW_ACTIONS_ATTR], '1')
  assert.equal(addTip.attrs[CLAW_ACTIONS_ATTR], '1')
  assert.equal(view.attrs[CLAW_ACTIONS_ATTR], '1')
})

test('claw zone is detected from the zone switch', () => {
  const clawBtn = { getAttribute(name) { return name === 'data-active' ? 'true' : '' } }
  const doc = {
    querySelector(sel) {
      if (sel === '[data-dar-zone-switch] [data-zone="claw"][data-active="true"]') return clawBtn
      return null
    },
  }
  assert.equal(detectClawZone(doc), true)
  assert.equal(detectClawZone({ querySelector() { return null } }), false)
})

test('hero workspace chip is recognized and hidden in claw chrome', () => {
  const attrs = {}
  const chip = {
    tagName: 'BUTTON',
    getAttribute(name) {
      if (name === 'aria-label') return '选择工作区'
      if (name === 'aria-haspopup') return 'menu'
      return attrs[name]
    },
    setAttribute(name, value) { attrs[name] = value },
    removeAttribute(name) { delete attrs[name] },
  }
  assert.equal(isWorkspaceSeatButton(chip), true)
  const add = {
    textContent: '添加工作区…',
    closest(sel) { return sel === '[role="menu"]' ? menu : null },
  }
  const menu = {
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = value },
    removeAttribute(name) { delete this.attrs[name] },
  }
  const doc = {
    querySelectorAll(sel) {
      if (sel === 'button') return [chip]
      if (sel === '[role="menuitem"]') return [add]
      return []
    },
  }
  hideClawSessionSeat(doc, true, new Set())
  assert.equal(chip.getAttribute(WORKSPACE_HIDE_ATTR), '1')
  assert.equal(menu.attrs[WORKSPACE_HIDE_ATTR], '1')
})

test('composer access chip is recognized for Claw hide', () => {
  const btn = { tagName: 'BUTTON', closest() { return null }, getAttribute(name) { return name === 'aria-label' ? '访问模式，当前：Full access' : '' }, textContent: 'Full access' }
  assert.equal(isAccessSeatButton(btn), true)
  assert.equal(isAccessMenuItem({ textContent: 'Workspace Write' }), true)
  assert.equal(isAccessMenuItem({ textContent: '标准模式' }), false)
  const en = { tagName: 'BUTTON', closest() { return null }, getAttribute(name) { return name === 'aria-label' ? 'Access mode, current: Read Only' : '' }, textContent: 'Read Only' }
  assert.equal(isAccessSeatButton(en), true)
  assert.equal(CLAW_SESSION_ATTR, 'data-dar-claw-session')
})

test('settings Agent preset and Permission selectors stay visible', () => {
  const dialog = { tagName: 'DIV' }
  const settingsPerm = {
    tagName: 'BUTTON',
    closest(sel) { return sel === '[role="dialog"]' ? dialog : null },
    getAttribute() { return '' },
    textContent: 'Read Only',
  }
  const settingsPreset = {
    tagName: 'BUTTON',
    closest(sel) { return sel === '[role="dialog"]' ? dialog : null },
    getAttribute(name) { return name === 'aria-haspopup' ? 'menu' : '' },
    textContent: '标准模式',
  }
  const settingsPermBare = {
    tagName: 'BUTTON',
    closest() { return null },
    getAttribute() { return '' },
    textContent: 'Workspace Write',
  }
  assert.equal(inProtectedChrome(settingsPerm), true)
  assert.equal(isAccessSeatButton(settingsPerm), false)
  assert.equal(isAccessSeatButton(settingsPermBare), false)
  assert.equal(isPresetSeatButton(settingsPreset, new Set()), false)
})

test('saveRegistry round-trips', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dar-'))
  const file = join(dir, 'registry.json')
  const bound = ensureBinding(emptyRegistry(), { id: 'ws', path: '/tmp/w', title: 'W' })
  await saveRegistry(file, bound.registry)
  const text = await readFile(file, 'utf8')
  assert.match(text, /"wa_ws"/)
  const loaded = await loadRegistry(file)
  assert.equal(loaded.agents.wa_ws.workspaceId, 'ws')
})
