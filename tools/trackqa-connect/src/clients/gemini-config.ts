import { lstat, mkdir, open, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { ConnectorError, requireValue } from '../core.ts'
import type { Setup } from '../core.ts'
import { fingerprint } from './codex.ts'
import { commitWindowsSettings } from './gemini-windows.ts'

export type Settings = Record<string, unknown>
const object = (value: unknown): value is Settings => !!value && typeof value === 'object' && !Array.isArray(value)
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

export function parseGeminiSettings(bytes: Buffer): Settings {
  requireValue(bytes.length <= 1_048_576, 'configuration_unreadable')
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    const value: unknown = JSON.parse(text)
    requireValue(object(value) && (value.mcpServers === undefined || (object(value.mcpServers) && Object.values(value.mcpServers).every(object))), 'configuration_unreadable')
    // JSON.parse accepts duplicate keys and unrepresentable numbers. Reject
    // these rather than silently losing unrelated data during serialization.
    const tokens = text.match(/"(?:[^"\\]|\\.)*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}[\]:,]/g) ?? []
    let index = 0
    const visit = (depth: number) => {
      requireValue(depth <= 64, 'configuration_unreadable')
      const token = tokens[index++]
      if (token === '{') {
        const keys = new Set<string>()
        while (tokens[index] !== '}') {
          const key = JSON.parse(tokens[index++]) as string
          requireValue(!keys.has(key), 'configuration_unreadable'); keys.add(key)
          index++; visit(depth + 1)
          if (tokens[index] !== ',') break
          index++
        }
        index++
      } else if (token === '[') {
        while (tokens[index] !== ']') { visit(depth + 1); if (tokens[index] !== ',') break; index++ }
        index++
      } else if (/^-?\d/.test(token)) {
        const number = Number(token)
        requireValue(Number.isFinite(number) && (!Number.isInteger(number) || Number.isSafeInteger(number)), 'configuration_unreadable')
      }
    }
    visit(0)
    return value
  } catch { throw new ConnectorError('configuration_unreadable') }
}

type Snapshot = { exists: boolean; hash: string | null; identity: string; bytes: Buffer | null; value: Settings }
async function directory(home: string, create = false) {
  requireValue(path.isAbsolute(home), 'configuration_location_untrusted')
  const dir = path.join(home, '.gemini')
  try {
    const info = await lstat(dir)
    requireValue(info.isDirectory() && !info.isSymbolicLink() && (await realpath(dir)).toLowerCase() === path.resolve(dir).toLowerCase(), 'configuration_location_untrusted')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    if (create) { await mkdir(dir, { mode: 0o700 }); return directory(home) }
  }
  return dir
}
async function snapshot(file: string): Promise<Snapshot> {
  let info
  try { info = await lstat(file, { bigint: true }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false, hash: null, identity: '', bytes: null, value: {} }
    throw new ConnectorError('configuration_unreadable')
  }
  requireValue(info.isFile() && !info.isSymbolicLink() && info.nlink === 1n && info.size <= 1_048_576n, 'configuration_unreadable')
  const identity = (stat: typeof info) => [stat.dev, stat.ino, stat.mtimeNs, stat.ctimeNs, stat.size, stat.mode].join(':')
  const handle = await open(file, 'r')
  try {
    requireValue(identity(await handle.stat({ bigint: true })) === identity(info), 'configuration_changed')
    const bytes = await handle.readFile()
    requireValue(identity(await handle.stat({ bigint: true })) === identity(info), 'configuration_changed')
    return { exists: true, hash: sha(bytes), identity: identity(info), bytes, value: parseGeminiSettings(bytes) }
  } finally { await handle.close() }
}
export async function readGeminiSettings(home: string) {
  return (await snapshot(path.join(await directory(home), 'settings.json'))).value
}
export const geminiHeader = (setup: Setup) => `Bearer \${${setup.envVar}}`
export function geminiEntry(setup: Setup) {
  requireValue(/^trackqa_[A-Za-z0-9_]+$/.test(setup.serverName) && /^TRACKQA_[A-Z0-9_]+$/.test(setup.envVar), 'configuration_conflict')
  return { url: setup.endpoint, type: 'http', headers: { Authorization: geminiHeader(setup) } }
}
export function matchesGeminiEntry(value: unknown, setup: Setup): boolean {
  if (!object(value) || !object(value.headers)) return false
  const legacy = value.httpUrl === setup.endpoint && value.url === undefined && (value.type === undefined || value.type === 'http')
  const current = value.url === setup.endpoint && value.type === 'http' && value.httpUrl === undefined
  return (legacy || current) && value.command === undefined && value.trust !== true
    && Object.keys(value.headers).length === 1 && value.headers.Authorization === geminiHeader(setup)
    && Object.keys(value).every(key => ['httpUrl', 'url', 'type', 'headers', 'timeout', 'description', 'trust'].includes(key))
}

// Optimistic checks + an advisory lock for cooperating writers, NOT a filesystem
// compare-and-swap. Non-cooperating editors must be closed during setup/cleanup.
export async function editGeminiSettings(home: string, setup: Setup, operation: 'install' | 'remove', hash: string | null = null,
  commit = commitWindowsSettings): Promise<string | null> {
  const ownedEntry = geminiEntry(setup)
  const dir = await directory(home), file = path.join(dir, 'settings.json')
  const before = await snapshot(file), existing = (before.value.mcpServers ?? {}) as Settings
  if (operation === 'remove' && !Object.hasOwn(existing, setup.serverName)) return null
  if (operation === 'install') requireValue(!Object.hasOwn(existing, setup.serverName), 'configuration_conflict')
  else requireValue(hash && matchesGeminiEntry(existing[setup.serverName], setup) && fingerprint(existing[setup.serverName]) === hash, 'configuration_changed')
  const entries = { ...existing }
  if (operation === 'install') entries[setup.serverName] = ownedEntry
  else delete entries[setup.serverName]
  const updated = { ...before.value, mcpServers: entries }
  const bytes = Buffer.from(JSON.stringify(updated, null, 2) + '\n')
  parseGeminiSettings(bytes)
  await directory(home, true)
  const current = await snapshot(file)
  requireValue(current.exists === before.exists && current.identity === before.identity && current.hash === before.hash, 'configuration_changed')
  await commit(file, { exists: before.exists, hash: before.hash }, bytes)
  const after = await snapshot(file)
  requireValue(after.hash === sha(bytes), 'configuration_write_uncertain')
  return operation === 'install' ? fingerprint(entries[setup.serverName]) : null
}
