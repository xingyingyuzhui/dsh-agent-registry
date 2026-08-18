import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply, inject, name, _internal } from '../host.js'

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

test('apply registers POST routes and disposes them', () => {
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
  assert.equal(routes.length, 10)
  assert.ok(routes.every((row) => row.kind === 'exact'))
  assert.deepEqual(routes.map((row) => row.path), [
    '/dsh-agent-registry/list',
    '/dsh-agent-registry/explain',
    '/dsh-agent-registry/archive',
    '/dsh-agent-registry/rename',
    '/dsh-agent-registry/create',
    '/dsh-agent-registry/policy',
    '/dsh-agent-registry/skills',
    '/dsh-agent-registry/models',
    '/dsh-agent-registry/model',
    '/dsh-agent-registry/restore',
  ])
  ctx._stop()
  assert.equal(disposed.length, 10)
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

test('missing claw preset ids resolve to standard on the host', async () => {
  const seen = []
  const ctx = {
    workspaceRegistry: { list() { return [] } },
    agentPresets: {
      defaultId: 'standard',
      authorable: true,
      async list() {
        return [
          { id: 'standard' },
          { id: 'code' },
          { id: 'minimal' },
          { id: 'cordis' },
          { id: 'wa-template' },
          { id: 'wa-test1' },
        ]
      },
      async copy() {},
      async resolve(id) {
        seen.push(id)
        if (id === 'standard' || id === 'wa-test1') return { id }
        const err = new Error('agent-presets: preset "' + id + '" not found')
        throw err
      },
    },
    webServer: { register() { return () => {} } },
    effect(factory) {
      ctx._stop = factory()
    },
  }
  apply(ctx)
  const missing = await ctx.agentPresets.resolve('wa-2e263a19-08cd-4274-b2af-42286f96b517')
  assert.deepEqual(missing, { id: 'standard' })
  const live = await ctx.agentPresets.resolve('wa-test1')
  assert.deepEqual(live, { id: 'wa-test1' })
  assert.deepEqual(seen, ['standard', 'wa-test1'])
  ctx._stop()
})
