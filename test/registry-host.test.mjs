import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply, inject, name, _internal } from '../host.js'

_internal.migrateOnApply = false

function postReq() {
  const req = new EventEmitter()
  req.method = 'POST'
  req.headers = { 'x-dsh-agent-registry': '1' }
  queueMicrotask(() => req.emit('end'))
  return req
}

test('host named exports', () => {
  assert.equal(name, 'dsh-agent-registry')
  assert.deepEqual(inject, ['webServer', 'workspaceRegistry', 'agentPresets', 'settings'])
})

test('apply registers POST routes and disposes them', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dar-home-'))
  _internal.setDshHome(dir)
  const disposed = []
  const routes = []
  const ctx = {
    workspaceRegistry: { list() { return [] } },
    agentPresets: { list: async () => [], copy: async () => {}, authorable: true },
    webServer: {
      register(entry) {
        routes.push(entry)
        return () => disposed.push(entry.path)
      },
    },
    effect(factory) {
      const stop = factory()
      ctx._stop = stop
    },
  }
  apply(ctx)
  assert.equal(routes.length, 13)
  assert.ok(routes.every((row) => row.kind === 'exact'))
  assert.deepEqual(routes.map((row) => row.path), [
    '/dsh-agent-registry/list',
    '/dsh-agent-registry/explain',
    '/dsh-agent-registry/archive',
    '/dsh-agent-registry/rename',
    '/dsh-agent-registry/create',
    '/dsh-agent-registry/diag',
    '/dsh-agent-registry/policy',
    '/dsh-agent-registry/skills',
    '/dsh-agent-registry/models',
    '/dsh-agent-registry/model',
    '/dsh-agent-registry/leave-behind',
    '/dsh-agent-registry/template',
    '/dsh-agent-registry/restore',
  ])
  ctx._stop()
  assert.equal(disposed.length, 13)
})

test('list handler does not bind ordinary workspaces', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dar-home-'))
  _internal.setDshHome(dir)
  const copies = []
  let body = ''
  let status = 0
  const res = {
    writeHead(code) { status = code },
    end(text) { body = text },
  }
  const req = postReq()
  const routes = []
  const ctx = {
    workspaceRegistry: {
      list() {
        return [{ id: 'ws-a', path: '/tmp/project', title: 'Project', sessionIds: ['s1'] }]
      },
    },
    agentPresets: {
      authorable: true,
      defaultId: 'standard',
      async list() { return [{ id: 'minimal' }, { id: 'standard' }] },
      async copy(from, id) { copies.push({ from, id }) },
    },
    settings: {
      async mutate(ns, ops) { ctx._ops.push({ ns, ops }) },
    },
    webServer: {
      register(entry) {
        routes.push(entry)
        return () => {}
      },
    },
    effect() {},
  }
  ctx._ops = []
  apply(ctx)
  const list = routes.find((row) => row.path.endsWith('/list'))
  await list.handler(req, res)
  assert.equal(status, 200)
  const payload = JSON.parse(body)
  assert.equal(payload.ok, true)
  assert.equal(payload.agents.length, 0)
  assert.equal(copies.length, 0)
  assert.match(payload.clawHome, /DSclaw/)
})

test('host does not wrap agentPresets composition APIs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dar-home-'))
  _internal.setDshHome(dir)
  const resolve = async (id) => ({ id })
  const mount = async () => ({})
  const recompose = async () => ({})
  const standingKeyFor = async (id) => ({ agentPreset: id })
  const ctx = {
    workspaceRegistry: { list() { return [] } },
    agentPresets: {
      defaultId: 'standard',
      authorable: true,
      async list() { return [{ id: 'standard' }] },
      resolve,
      mount,
      recompose,
      standingKeyFor,
      async copy() {},
    },
    webServer: { register() { return () => {} } },
    effect(factory) { ctx._stop = factory() },
  }
  apply(ctx)
  assert.equal(ctx.agentPresets.resolve, resolve)
  assert.equal(ctx.agentPresets.mount, mount)
  assert.equal(ctx.agentPresets.recompose, recompose)
  assert.equal(ctx.agentPresets.standingKeyFor, standingKeyFor)
  ctx._stop()
})

test('create skips a non-empty orphan directory instead of overwriting it', async () => {
  const { mkdir, writeFile, readFile } = await import('node:fs/promises')
  const dir = await mkdtemp(join(tmpdir(), 'dar-home-'))
  _internal.setDshHome(dir)
  const orphan = join(dir, 'DSclaw', 'demo')
  await mkdir(orphan, { recursive: true })
  await writeFile(join(orphan, 'SOUL.md'), 'keep custom soul\n')
  let body = ''
  let status = 0
  const res = {
    writeHead(code) { status = code },
    end(text) { body = text },
  }
  const routes = []
  const ctx = {
    workspaceRegistry: {
      list() { return [] },
      async create(path, title) {
        return { id: 'ws-new', path, title }
      },
    },
    agentPresets: { authorable: true, async list() { return [] }, async copy() {} },
    settings: { async mutate() {} },
    webServer: {
      register(entry) {
        routes.push(entry)
        return () => {}
      },
    },
    effect() {},
  }
  apply(ctx)
  const handler = routes.find((row) => row.path.endsWith('/create')).handler
  const req = new EventEmitter()
  req.method = 'POST'
  req.headers = { 'x-dsh-agent-registry': '1' }
  queueMicrotask(() => {
    req.emit('data', Buffer.from(JSON.stringify({ name: 'Demo' })))
    req.emit('end')
  })
  await handler(req, res)
  assert.equal(status, 200)
  const payload = JSON.parse(body)
  assert.equal(payload.ok, true)
  assert.equal(payload.agent.slug, 'demo-2')
  assert.equal(await readFile(join(orphan, 'SOUL.md'), 'utf8'), 'keep custom soul\n')
})
