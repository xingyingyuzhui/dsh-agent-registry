import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib'
import { isClawPresetId } from './registry-presets.mjs'

export const MIGRATE_VERSION = 2
export const QUARANTINE_DIR = 'workspace-agents/quarantine-presets'
const USER_PRESET_DIR = '.agent-presets'
const ZSTD_MAGIC = 0xFD2FB528

export function userPresetRoot(home) {
  return join(home, USER_PRESET_DIR)
}

export function quarantineRoot(home) {
  return join(home, QUARANTINE_DIR)
}

export function sessionsRoot(home) {
  return join(home, 'sessions')
}

export function resolveLogPreset(text) {
  const lines = String(text || '').split('\n')
  let header
  let selected
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    let row
    try { row = JSON.parse(line) } catch { continue }
    if (row && row.type === 'session') header = row.agentPreset
    if (row && row.type === 'agent-preset/selected' && row.data && typeof row.data.agentPreset === 'string') {
      selected = row.data.agentPreset
    }
  }
  return selected !== undefined ? selected : header
}

export function rewriteSessionLog(text, preset = 'standard') {
  const raw = String(text || '')
  const resolved = resolveLogPreset(raw)
  if (!isClawPresetId(resolved)) return { text: raw, changed: false, from: resolved, to: preset }
  const lines = raw.split('\n')
  let lastSeq = -1
  let lastWasEmpty = raw.endsWith('\n') || raw === ''
  const next = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === '' && i === lines.length - 1) {
      next.push(line)
      continue
    }
    let row
    try { row = JSON.parse(line) } catch {
      next.push(line)
      continue
    }
    if (row && typeof row.seq === 'number' && Number.isFinite(row.seq)) lastSeq = Math.max(lastSeq, row.seq)
    if (row && row.type === 'session' && isClawPresetId(row.agentPreset)) {
      next.push(JSON.stringify({ ...row, agentPreset: preset }))
      continue
    }
    next.push(line)
  }
  const event = JSON.stringify({
    type: 'agent-preset/selected',
    seq: lastSeq + 1,
    time: Date.now(),
    data: { agentPreset: preset, source: 'dsh-agent-registry-migrate' },
  })
  if (next.length && next[next.length - 1] === '') next[next.length - 1] = event
  else next.push(event)
  let out = next.join('\n')
  if (lastWasEmpty && !out.endsWith('\n')) out += '\n'
  return { text: out, changed: true, from: resolved, to: preset }
}

function isZstd(buf) {
  return buf.length >= 4 && buf.readUInt32LE(0) === ZSTD_MAGIC
}

function decompressLog(buf) {
  if (buf.length === 0) return ''
  if (buf[0] === 0x7b) return buf.toString('utf8')
  if (!isZstd(buf)) return buf.toString('utf8')
  const cli = spawnSync('zstd', ['-dc'], { input: buf, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (cli.status === 0 && typeof cli.stdout === 'string') return cli.stdout
  try {
    return zstdDecompressSync(buf).toString('utf8')
  } catch {
    throw new Error(String(cli.stderr || 'zstd decompress failed'))
  }
}

const CHECKSUM_OPTIONS = {
  params: { [constants.ZSTD_c_checksumFlag]: 1 },
}

export function firstFrameIsHeaderLine(buf) {
  if (!Buffer.isBuffer(buf) || !isZstd(buf)) return false
  try {
    const plain = zstdDecompressSync(buf)
    return plain.length > 0 && plain.indexOf(10) === plain.length - 1
  } catch {
    return false
  }
}

function compressFrame(text) {
  return zstdCompressSync(Buffer.from(text, 'utf8'), CHECKSUM_OPTIONS)
}

function compressLog(text) {
  const raw = String(text || '')
  const nl = raw.indexOf('\n')
  const header = nl === -1 ? raw + '\n' : raw.slice(0, nl + 1)
  const rest = nl === -1 ? '' : raw.slice(nl + 1)
  const headerFrame = compressFrame(header)
  if (!rest) return headerFrame
  return Buffer.concat([headerFrame, compressFrame(rest)])
}

export function migrateSessionFile(file) {
  const buf = readFileSync(file)
  const zstd = isZstd(buf)
  const current = decompressLog(buf)
  const next = rewriteSessionLog(current)
  const framingBroken = zstd && !firstFrameIsHeaderLine(buf)
  if (!next.changed && !framingBroken) return { file, changed: false, from: next.from, to: next.to }
  const tmp = file + '.migrate-tmp'
  writeFileSync(tmp, zstd ? compressLog(next.changed ? next.text : current) : (next.changed ? next.text : current))
  renameSync(tmp, file)
  return {
    file,
    changed: true,
    from: next.from,
    to: next.to,
    framing: framingBroken && !next.changed ? 'repaired' : undefined,
  }
}

export function listClawPresetDirs(home) {
  let names
  try {
    names = readdirSync(userPresetRoot(home))
  } catch {
    return []
  }
  const out = []
  for (const name of names) {
    if (!isClawPresetId(name)) continue
    try {
      if (statSync(join(userPresetRoot(home), name)).isDirectory()) out.push(name)
    } catch { /* skip */ }
  }
  return out
}

export function quarantineClawPresets(home) {
  const names = listClawPresetDirs(home)
  const moved = []
  if (names.length === 0) return moved
  mkdirSync(quarantineRoot(home), { recursive: true })
  for (const name of names) {
    const from = join(userPresetRoot(home), name)
    let dest = join(quarantineRoot(home), name)
    if (existsSafe(dest)) dest = dest + '-' + Date.now()
    try {
      renameSync(from, dest)
      moved.push({ id: name, from, to: dest })
    } catch { /* leave in place; next boot retries */ }
  }
  return moved
}

function existsSafe(path) {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}

export const MARKER_FILE = 'workspace-agents/legacy-migrate.json'

export function markerPath(home) {
  return join(home, MARKER_FILE)
}

function relFromHome(home, file) {
  const root = String(home || '')
  const path = String(file || '')
  if (root && (path === root || path.startsWith(root + '/') || path.startsWith(root + '\\'))) {
    return path.slice(root.length).replace(/^[\\/]/, '')
  }
  return path
}

function readMarker(home) {
  try {
    const raw = JSON.parse(readFileSync(markerPath(home), 'utf8'))
    return raw && typeof raw === 'object' ? raw : null
  } catch {
    return null
  }
}

function writeMarker(home, result) {
  mkdirSync(join(home, 'workspace-agents'), { recursive: true })
  const tmp = markerPath(home) + '.tmp'
  writeFileSync(tmp, JSON.stringify(result, null, 2) + '\n')
  renameSync(tmp, markerPath(home))
}

export function migrateSessionTree(home) {
  const root = sessionsRoot(home)
  const changed = []
  const errors = []
  const walk = [root]
  while (walk.length) {
    const dir = walk.pop()
    let names
    try { names = readdirSync(dir) } catch { continue }
    for (const name of names) {
      const path = join(dir, name)
      let st
      try { st = statSync(path) } catch { continue }
      if (st.isDirectory()) {
        walk.push(path)
        continue
      }
      if (!name.endsWith('.jsonl') && !name.endsWith('.jsonl.zstd')) continue
      try {
        const result = migrateSessionFile(path)
        if (result.changed) changed.push(result)
      } catch (error) {
        errors.push({
          file: path,
          error: error && error.message ? error.message : String(error),
        })
      }
    }
  }
  return { changed, errors }
}

export function migrateClawLegacy(home) {
  const quarantined = quarantineClawPresets(home)
  const prev = readMarker(home)
  if (prev && Number(prev.version) >= MIGRATE_VERSION && quarantined.length === 0 && !prev.incomplete) {
    return { ...prev, skipped: true, quarantined: [], sessions: [], errors: [] }
  }
  const { changed, errors } = migrateSessionTree(home)
  const result = {
    version: MIGRATE_VERSION,
    at: new Date().toISOString(),
    quarantined: [...new Set([
      ...(prev && prev.incomplete && Array.isArray(prev.quarantined) ? prev.quarantined : []),
      ...quarantined.map((row) => row.id),
    ])],
    sessions: changed.map((row) => ({ file: relFromHome(home, row.file), from: row.from, to: row.to })),
    errors: errors.map((row) => ({ file: relFromHome(home, row.file), error: row.error })),
    incomplete: errors.length > 0,
  }
  writeMarker(home, result)
  return result
}
