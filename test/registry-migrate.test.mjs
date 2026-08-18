import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import test from 'node:test'
import { apply, _internal } from '../host.js'
import {
  firstFrameIsHeaderLine,
  migrateClawLegacy,
  migrateSessionFile,
  quarantineRoot,
  resolveLogPreset,
  rewriteSessionLog,
  userPresetRoot,
} from '../registry-migrate.mjs'

function sessionLog(headerPreset, selected, extra = []) {
  const rows = [
    { type: 'session', id: 'session-demo', agentPreset: headerPreset, createdAt: 1, version: 0 },
    { type: 'permission/preset', seq: 0, time: 1, data: { preset: 'safe' } },
  ]
  let seq = 1
  for (const id of selected) {
    rows.push({ type: 'agent-preset/selected', seq, time: seq, data: { agentPreset: id } })
    seq += 1
  }
  for (const row of extra) {
    rows.push({ ...row, seq: row.seq == null ? seq : row.seq, time: row.time == null ? seq : row.time })
    seq += 1
  }
  return rows.map((row) => JSON.stringify(row)).join('\n') + '\n'
}

test('resolveLogPreset last selected wins over header', () => {
  const text = sessionLog('standard', ['wa-test2', 'wa-test2'])
  assert.equal(resolveLogPreset(text), 'wa-test2')
  assert.equal(resolveLogPreset(sessionLog('wa-test3', [])), 'wa-test3')
  assert.equal(resolveLogPreset(sessionLog('standard', [])), 'standard')
})

test('rewrite is a no-op when the resolved preset is already official', () => {
  const text = sessionLog('standard', ['code'])
  const next = rewriteSessionLog(text)
  assert.equal(next.changed, false)
  assert.equal(next.text, text)
  assert.equal(next.from, 'code')
})

test('rewrite header-only wa-* and append last selected standard', () => {
  const text = sessionLog('wa-test3', [])
  const next = rewriteSessionLog(text)
  assert.equal(next.changed, true)
  assert.equal(next.from, 'wa-test3')
  assert.equal(next.to, 'standard')
  assert.equal(resolveLogPreset(next.text), 'standard')
  const rows = next.text.trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(rows[0].agentPreset, 'standard')
  const selected = rows.filter((row) => row.type === 'agent-preset/selected')
  assert.equal(selected.length, 1)
  assert.equal(selected[0].data.agentPreset, 'standard')
  assert.equal(selected[0].data.source, 'dsh-agent-registry-migrate')
  assert.equal(selected[0].seq, 1)
})

test('rewrite last-selected wa-* keeps a non-claw header and appends standard', () => {
  const text = sessionLog('standard', ['wa-test2'])
  const next = rewriteSessionLog(text)
  assert.equal(next.changed, true)
  const rows = next.text.trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(rows[0].agentPreset, 'standard')
  const selected = rows.filter((row) => row.type === 'agent-preset/selected')
  assert.equal(selected.at(-1).data.agentPreset, 'standard')
  assert.equal(selected.at(-1).seq, 2)
  assert.equal(resolveLogPreset(next.text), 'standard')
})

test('quarantine moves leftover wa-* dirs and leaves shipped presets', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dar-mig-'))
  mkdirSync(join(userPresetRoot(home), 'wa-test1'), { recursive: true })
  mkdirSync(join(userPresetRoot(home), 'wa-template'), { recursive: true })
  mkdirSync(join(userPresetRoot(home), 'standard'), { recursive: true })
  mkdirSync(join(home, 'DSclaw', 'test1'), { recursive: true })
  writeFileSync(join(userPresetRoot(home), 'wa-test1', 'preset.yml'), 'name: leftover\n')
  writeFileSync(join(userPresetRoot(home), 'standard', 'preset.yml'), 'name: standard\n')
  writeFileSync(join(home, 'DSclaw', 'test1', 'SOUL.md'), 'keep custom soul\n')
  const first = migrateClawLegacy(home)
  assert.deepEqual(new Set(first.quarantined), new Set(['wa-test1', 'wa-template']))
  assert.equal(first.skipped, undefined)
  assert.ok(readFileSync(join(quarantineRoot(home), 'wa-test1', 'preset.yml'), 'utf8').includes('leftover'))
  assert.equal(readFileSync(join(userPresetRoot(home), 'standard', 'preset.yml'), 'utf8'), 'name: standard\n')
  assert.equal(readFileSync(join(home, 'DSclaw', 'test1', 'SOUL.md'), 'utf8'), 'keep custom soul\n')
  const listed = migrateClawLegacy(home)
  assert.equal(listed.skipped, true)
  assert.deepEqual(listed.quarantined, [])
  assert.equal(readFileSync(join(userPresetRoot(home), 'standard', 'preset.yml'), 'utf8'), 'name: standard\n')
  assert.equal(readFileSync(join(home, 'DSclaw', 'test1', 'SOUL.md'), 'utf8'), 'keep custom soul\n')
})

test('migrateSessionFile rewrites plaintext and zstd session logs', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dar-mig-sess-'))
  const dir = join(home, 'sessions', 'claw-demo', 'session-aaaa')
  mkdirSync(dir, { recursive: true })
  const plain = join(dir, 'session.jsonl')
  const zstd = join(dir, 'session.jsonl.zstd')
  writeFileSync(plain, sessionLog('wa-test4', []))
  const packed = zstdCompressSync(Buffer.from(sessionLog('standard', ['wa-test1']), 'utf8'))
  writeFileSync(zstd, packed)
  assert.equal(migrateSessionFile(plain).changed, true)
  assert.equal(resolveLogPreset(readFileSync(plain, 'utf8')), 'standard')
  const again = migrateSessionFile(plain)
  assert.equal(again.changed, false)
  const zstdResult = migrateSessionFile(zstd)
  assert.equal(zstdResult.changed, true)
  const rewritten = readFileSync(zstd)
  assert.equal(firstFrameIsHeaderLine(rewritten), true)
  const headerPlain = zstdDecompressSync(rewritten).toString('utf8')
  assert.match(headerPlain, /^\{"type":"session"/)
  assert.equal(headerPlain.endsWith('\n'), true)
  assert.equal(headerPlain.indexOf('\n'), headerPlain.length - 1)
  const cli = spawnSync('zstd', ['-dc', zstd], { encoding: 'utf8' })
  const inflated = cli.status === 0 ? cli.stdout : null
  assert.ok(inflated, 'zstd -dc should inflate the rewritten log')
  assert.equal(resolveLogPreset(inflated), 'standard')
})

test('migrateSessionFile repairs a single-frame zstd log that already resolves to standard', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dar-mig-frame-'))
  const dir = join(home, 'sessions', 'claw-demo', 'session-cccc')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'session.jsonl.zstd')
  const text = sessionLog('standard', ['standard'])
  writeFileSync(file, zstdCompressSync(Buffer.from(text, 'utf8')))
  assert.equal(firstFrameIsHeaderLine(readFileSync(file)), false)
  const result = migrateSessionFile(file)
  assert.equal(result.changed, true)
  assert.equal(result.framing, 'repaired')
  assert.equal(firstFrameIsHeaderLine(readFileSync(file)), true)
  const cli = spawnSync('zstd', ['-dc', file], { encoding: 'utf8' })
  assert.equal(resolveLogPreset(cli.stdout), 'standard')
})

test('apply migrates leftover presets before registering routes', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dar-mig-apply-'))
  _internal.setDshHome(home)
  _internal.migrateOnApply = true
  mkdirSync(join(userPresetRoot(home), 'wa-test2'), { recursive: true })
  writeFileSync(join(userPresetRoot(home), 'wa-test2', 'preset.yml'), 'name: leftover\n')
  const sessDir = join(home, 'sessions', 'one', 'session-bbbb')
  mkdirSync(sessDir, { recursive: true })
  writeFileSync(join(sessDir, 'session.jsonl'), sessionLog('wa-test2', []))
  mkdirSync(join(home, 'DSclaw', 'test2'), { recursive: true })
  writeFileSync(join(home, 'DSclaw', 'test2', 'SOUL.md'), 'soul stays\n')
  writeFileSync(join(home, 'DSclaw', 'test2', 'AGENTS.md'), 'agents stays\n')
  writeFileSync(join(home, 'DSclaw', 'test2', 'USER.md'), 'user stays\n')
  const selectCalls = []
  const ctx = {
    workspaceRegistry: { list() { return [] } },
    agentPresets: {
      authorable: true,
      async list() { return [{ id: 'standard' }] },
      async select(id) { selectCalls.push(id) },
    },
    webServer: { register() { return () => {} } },
    effect() {},
    logger: { info() {}, warn() {} },
  }
  try {
    apply(ctx)
    assert.equal(selectCalls.length, 0)
    assert.ok(readFileSync(join(quarantineRoot(home), 'wa-test2', 'preset.yml'), 'utf8').includes('leftover'))
    assert.equal(resolveLogPreset(readFileSync(join(sessDir, 'session.jsonl'), 'utf8')), 'standard')
    assert.equal(readFileSync(join(home, 'DSclaw', 'test2', 'SOUL.md'), 'utf8'), 'soul stays\n')
    assert.equal(readFileSync(join(home, 'DSclaw', 'test2', 'AGENTS.md'), 'utf8'), 'agents stays\n')
    assert.equal(readFileSync(join(home, 'DSclaw', 'test2', 'USER.md'), 'utf8'), 'user stays\n')
  } finally {
    _internal.migrateOnApply = false
  }
})
