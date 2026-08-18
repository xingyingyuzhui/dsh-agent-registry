import assert from 'node:assert/strict'
import test from 'node:test'
import { COPY, isZh, tWith, translate } from '../registry-i18n.mjs'
import { TOOL_IDS } from '../registry-presets.mjs'

const ZH_HAN = /[\u4e00-\u9fff]/

test('permission labels are Chinese in zh and English in en', () => {
  const presets = ['research', 'developer', 'reviewer', 'release', 'public']
  for (const id of presets) {
    const zh = COPY.zh['preset_' + id]
    const en = COPY.en['preset_' + id]
    assert.ok(zh, id)
    assert.match(zh, ZH_HAN)
    assert.notEqual(zh, id)
    assert.notEqual(zh, 'preset_' + id)
    assert.ok(en)
    assert.doesNotMatch(en, ZH_HAN)
  }
  for (const id of TOOL_IDS) {
    const zh = COPY.zh['tool_' + id]
    const en = COPY.en['tool_' + id]
    assert.match(zh, ZH_HAN)
    assert.notEqual(zh, id)
    assert.notEqual(zh, 'tool_' + id)
    assert.equal(COPY.zh[id], zh)
    assert.ok(en)
    assert.doesNotMatch(en, ZH_HAN)
  }
})

test('tWith ignores bind when it echoes the key', () => {
  const echo = {
    getLocale: () => ({ active: 'zh' }),
    bind: () => (key) => key,
  }
  assert.equal(tWith({ locale: echo }, 'tool_bash'), '命令行')
  assert.equal(tWith({ locale: echo }, 'preset_developer'), '开发')
  assert.equal(tWith({ locale: { getLocale: () => ({ active: 'en' }), bind: () => (key) => key } }, 'tool_bash'), 'Command line')
})

test('tWith prefers a real bind result', () => {
  const bound = tWith({
    locale: {
      getLocale: () => ({ active: 'en' }),
      bind: () => (key) => key === 'tool_bash' ? 'Shell' : key,
    },
  }, 'tool_bash')
  assert.equal(bound, 'Shell')
})

test('session stamp labels are locale-pure', () => {
  assert.match(COPY.zh.timeYesterday, ZH_HAN)
  assert.doesNotMatch(COPY.en.timeYesterday, ZH_HAN)
  assert.equal(translate('zh', 'timeMonthDay', { m: 8, d: 12 }), '8月12日')
  assert.equal(translate('en', 'timeMonthDay', { m: 8, d: 12 }), '8/12')
})

test('memory tab actions are locale-pure', () => {
  for (const key of ['tabMemory', 'memWrite', 'memWriteFree', 'memWriteAsk', 'memReview', 'memPending', 'memApprove', 'memReject']) {
    assert.match(COPY.zh[key], ZH_HAN)
    assert.doesNotMatch(COPY.en[key], ZH_HAN)
  }
})

test('core file actions are locale-pure', () => {
  for (const key of ['selectFile', 'resetFile', 'saveFile', 'resetTitle', 'resetBody', 'resetConfirm']) {
    assert.match(COPY.zh[key], ZH_HAN)
    assert.doesNotMatch(COPY.en[key], ZH_HAN)
  }
  assert.equal(translate('zh', 'resetTitle', { file: 'SOUL.md' }), '重置 SOUL.md？')
  assert.equal(translate('en', 'resetTitle', { file: 'SOUL.md' }), 'Reset SOUL.md?')
})

test('isZh follows official locale snapshot', () => {
  assert.equal(isZh({}), true)
  assert.equal(isZh({ locale: { getLocale: () => ({ active: 'en' }) } }), false)
  assert.equal(isZh({ locale: { getSnapshot: () => ({ active: 'zh' }) } }), true)
  assert.equal(translate('zh', 'tool_deploy'), '对外发布')
  assert.equal(translate('en', 'tool_deploy'), 'Publish')
})
