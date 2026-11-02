import { mkdir, open, readFile, rename, unlink, lstat } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { requireValue, UUID, setupFor } from './core.ts'
import type { Client } from './core.ts'

export type RecordState = {
  projectId: string; userId: string; client: Client; executable: string; codexHome?: string; geminiHome?: string; claudeHome?: string
  clientLabel: string; connectionId: string | null
  phase: 'planned' | 'installed' | 'issuing' | 'active' | 'revocation_pending' | 'revoked'
  installed: boolean; lastVerifiedAt: string | null
  configHash: string | null
}
const fields = ['projectId', 'userId', 'client', 'executable', 'clientLabel', 'connectionId', 'phase', 'installed', 'lastVerifiedAt', 'configHash']
export const recordHome = (record: RecordState) => record.client === 'claude' ? record.claudeHome! : record.client === 'gemini' ? record.geminiHome! : record.codexHome!
export function validateRecord(record: RecordState) {
  const homeKey = record?.client === 'claude' ? 'claudeHome' : record?.client === 'gemini' ? 'geminiHome' : 'codexHome'
  requireValue(record && Object.keys(record).length === fields.length + 1 && Object.keys(record).every(key => fields.includes(key) || key === homeKey)
    && ['codex', 'gemini', 'claude'].includes(record.client) && UUID.test(record.projectId) && UUID.test(record.userId)
    && (record.connectionId === null || UUID.test(record.connectionId))
    && /^TrackQA Connect [0-9a-f-]{36}$/.test(record.clientLabel)
    && ['planned', 'installed', 'issuing', 'active', 'revocation_pending', 'revoked'].includes(record.phase)
    && typeof record.installed === 'boolean' && path.isAbsolute(record.executable) && typeof recordHome(record) === 'string' && path.isAbsolute(recordHome(record))
    && (record.configHash === null || /^[0-9a-f]{64}$/.test(record.configHash))
    && (record.lastVerifiedAt === null || Number.isFinite(Date.parse(record.lastVerifiedAt))), 'recovery_invalid')
  setupFor(record.projectId, record.client)
}
export class Store {
  root: string
  constructor(root: string) { requireValue(path.isAbsolute(root), 'recovery_unavailable'); this.root = root }
  async prepare() {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    requireValue(!(await lstat(this.root)).isSymbolicLink(), 'recovery_unavailable')
  }
  async read(): Promise<RecordState[]> {
    try {
      const file = path.join(this.root, 'connections.json')
      const stat = await lstat(file)
      requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 131072, 'recovery_invalid')
      const records: RecordState[] = JSON.parse(await readFile(file, 'utf8'))
      requireValue(Array.isArray(records) && records.length <= 200, 'recovery_invalid')
      records.forEach(validateRecord)
      requireValue(new Set(records.map(record => `${record.client}:${record.projectId}`)).size === records.length, 'recovery_invalid')
      return records
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
  }
  async write(records: RecordState[]) {
    records.forEach(validateRecord)
    await this.prepare()
    const file = path.join(this.root, `state-${randomUUID()}.tmp`)
    const handle = await open(file, 'wx', 0o600)
    try { await handle.writeFile(JSON.stringify(records, null, 2) + '\n'); await handle.sync() }
    finally { await handle.close() }
    try { await rename(file, path.join(this.root, 'connections.json')) }
    finally { await unlink(file).catch(() => {}) }
  }
  async save(record: RecordState) {
    const records = await this.read()
    await this.write([...records.filter(item => item.projectId !== record.projectId || item.client !== record.client), record])
  }
  async remove(projectId: string, client: Client = 'codex') { await this.write((await this.read()).filter(record => record.projectId !== projectId || record.client !== client)) }
  async lock() {
    await this.prepare()
    const file = path.join(this.root, 'connector.lock')
    let handle
    try { handle = await open(file, 'wx', 0o600) } catch { throw new Error('connector_busy_or_stale_lock') }
    await handle.writeFile(JSON.stringify({ pid: process.pid }))
    return async () => { await handle.close(); await unlink(file) }
  }
}
