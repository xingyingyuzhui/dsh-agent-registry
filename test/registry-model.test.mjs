import assert from 'node:assert/strict'
import test from 'node:test'
import {
  currentClawBlankHint,
  effortLabel,
  findCatalogModel,
  findClawAgent,
  hasLoggedModel,
  modelKey,
  modelOfAgent,
  normalizeModel,
  resolveBlankSelection,
  selectionForCurrentSession,
} from '../registry-model.mjs'
import { emptyRegistry, ensureBinding, setAgentModel } from '../registry-store.mjs'

test('normalizeModel rejects empty routes', () => {
  assert.equal(normalizeModel(null), null)
  assert.equal(normalizeModel({ provider: 'p' }), null)
  assert.deepEqual(normalizeModel({ provider: ' p ', model: ' m ' }), { provider: 'p', model: 'm' })
  assert.equal(modelKey({ provider: 'p', model: 'm' }), 'p::m')
  assert.equal(modelKey(null), 'inherit')
})

test('blank claw session uses the agent model; logged requests keep official', () => {
  const official = { provider: 'off', model: 'default' }
  const claw = { provider: 'deepseek', model: 'deepseek-chat' }
  const blank = { session: { header: {}, requestHeader() { return undefined } } }
  const logged = { session: { header: {}, requestHeader() { return { config: official } } } }
  assert.deepEqual(resolveBlankSelection(blank, official, claw), claw)
  assert.deepEqual(resolveBlankSelection(logged, official, claw), official)
  assert.deepEqual(resolveBlankSelection(blank, official, null), official)
  assert.equal(hasLoggedModel(blank), false)
  assert.equal(hasLoggedModel(logged), true)
})

test('modelOfAgent matches cwd to the registry row', () => {
  const bound = ensureBinding(emptyRegistry(), { id: 'ws', path: '/tmp/claw', title: 'C' })
  const next = setAgentModel(bound.registry, bound.agent.agentId, { provider: 'deepseek', model: 'deepseek-chat' })
  const agent = { session: { header: { cwd: '/tmp/claw' } } }
  assert.deepEqual(modelOfAgent(next.registry, agent), { provider: 'deepseek', model: 'deepseek-chat' })
  assert.equal(findClawAgent(next.registry, { cwd: '/nope' }), null)
  assert.equal(findClawAgent(next.registry, { preset: 'standard' }), null)
})

test('selectionForCurrentSession only pins blank DSclaw sessions', () => {
  const bound = ensureBinding(emptyRegistry(), {
    id: 'ws',
    path: '/Users/qin/.dsh/DSclaw/test2',
    title: 'test2',
  })
  const registry = setAgentModel(bound.registry, bound.agent.agentId, {
    provider: 'deepseek',
    model: 'deepseek-chat',
  }).registry
  const official = { provider: 'off', model: 'default' }
  const claw = { provider: 'deepseek', model: 'deepseek-chat' }
  const blank = {
    current: 's1',
    byId: { s1: { blank: true, cwd: '/Users/qin/.dsh/DSclaw/test2', agentPreset: 'standard' } },
  }
  const spoken = {
    current: 's1',
    byId: { s1: { blank: false, cwd: '/Users/qin/.dsh/DSclaw/test2', agentPreset: 'standard' } },
  }
  const officialBlank = {
    current: 's2',
    byId: { s2: { blank: true, cwd: '/Users/qin/DSH', agentPreset: 'standard' } },
  }
  assert.deepEqual(currentClawBlankHint(blank), {
    cwd: '/Users/qin/.dsh/DSclaw/test2',
    preset: 'standard',
  })
  assert.equal(currentClawBlankHint(spoken), null)
  assert.equal(currentClawBlankHint(officialBlank), null)
  assert.deepEqual(selectionForCurrentSession(registry, official, blank), claw)
  assert.deepEqual(selectionForCurrentSession(registry, official, spoken), official)
  assert.deepEqual(selectionForCurrentSession(registry, official, officialBlank), official)
})

test('catalog lookup and effort labels', () => {
  const groups = [{
    id: 'opencode-go',
    name: 'OpenCode',
    models: [{
      id: 'deepseek-v4-flash',
      name: 'DeepSeek V4 Flash',
      reasoning: { defaultEffort: 'max', efforts: [{ id: 'max', name: 'Max' }, { id: 'low', name: 'Low' }] },
    }],
  }]
  const hit = findCatalogModel(groups, 'opencode-go', 'deepseek-v4-flash')
  assert.equal(hit.model.name, 'DeepSeek V4 Flash')
  assert.equal(effortLabel(hit.model.reasoning, 'max'), 'Max')
  assert.equal(effortLabel(hit.model.reasoning, undefined), 'Max')
})
