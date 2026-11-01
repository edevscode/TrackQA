import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { AUTH_URL, FIXTURE_PROJECT_ID, OwnerAuthError, authenticationFailure, withOwnerAuthentication } from './owner-auth.mjs'

export const BASE = AUTH_URL
export const SERVER = 'trackqaPilot'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TOKEN = /^tqm_[0-9a-f]{64}$/
const MARKER = 'trackqa-antigravity-pilot-v1'
const CONFIG = '.agents/mcp_config.json'
const STATE = 'pilot-state.json'
const safeError = () => new Error('Pilot operation failed. Run Cleanup; retain the recovery record if verification fails.')

export function disabledConfig(token) {
  if (token !== undefined && !TOKEN.test(token)) throw safeError()
  return { mcpServers: { [SERVER]: {
    serverUrl: `${BASE}/functions/v1/trackqa-mcp`, disabled: true,
    headers: token === undefined ? {} : { Authorization: `Bearer ${token}` },
    timeoutSeconds: 15,
    enabledTools: ['trackqa_connection_status', 'trackqa_list_projects', 'trackqa_list_issues', 'trackqa_get_issue'],
  } } }
}

// No credential is placed in the recovery record. All filesystem paths are fixed.
export function createStore(root) {
  async function check() {
    for (const name of ['', '.agents']) {
      const dir = path.join(root, name)
      const stat = await fs.lstat(dir)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw safeError()
    }
    if ((await fs.realpath(root)).toLowerCase() !== path.resolve(root).toLowerCase()) throw safeError()
  }
  async function read(name) {
    await check()
    const stat = await fs.lstat(path.join(root, name))
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 16_384) throw safeError()
    return JSON.parse(await fs.readFile(path.join(root, name), 'utf8'))
  }
  async function write(name, data, exclusive = false) {
    await check()
    const file = path.join(root, name)
    if (!exclusive) await read(name)
    if (name === STATE && !exclusive) {
      // Atomic nonsecret journal replacement preserves recovery identity if
      // interrupted. A leftover .next file requires manual inspection.
      const next = file + '.next'
      const handle = await fs.open(next, 'wx')
      try { await handle.writeFile(JSON.stringify(data, null, 2) + '\n'); await handle.sync() }
      finally { await handle.close() }
      await fs.rename(next, file)
      return
    }
    // No token-bearing temp/backup file. An interrupted write may be partial;
    // the recovery record precedes issuance and Cleanup can remove that file.
    const handle = await fs.open(file, exclusive ? 'wx' : 'r+')
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.nlink !== 1) throw safeError()
      await handle.truncate(0)
      await handle.writeFile(JSON.stringify(data, null, 2) + '\n', 'utf8')
      await handle.sync()
    } finally { await handle.close() }
  }
  return {
    async prepare() {
      await check()
      await write(STATE, { marker: MARKER, phase: 'prepared' }, true)
      await write(CONFIG, disabledConfig(), true)
      await fs.writeFile(path.join(root, '.gitignore'), '/.agents/mcp_config.json\n/pilot-state.json*\n/pilot-operation.lock\n', { flag: 'wx' })
    },
    readState: () => read(STATE),
    writeState: data => write(STATE, data),
    readConfig: () => read(CONFIG),
    writeConfig: data => write(CONFIG, data),
    async removeConfig() {
      await check()
      try {
        const file = path.join(root, CONFIG)
        const stat = await fs.lstat(file)
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw safeError()
        await fs.unlink(file)
      } catch (error) { if (error.code !== 'ENOENT') throw safeError() }
    },
  }
}

function claims(value) {
  try { return JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8')) }
  catch { throw safeError() }
}

// Existing Supabase human Auth and RLS are authoritative. Decoded claims only
// reject obviously wrong credential classes; they are never authentication.
export function createHumanApi({ ownerAccessToken, publicApiKey, fetch: send = globalThis.fetch, timeoutMs = 5000 }) {
  if (typeof ownerAccessToken !== 'string' || ownerAccessToken.length > 8192
    || /[\r\n]/.test(ownerAccessToken) || claims(ownerAccessToken).role !== 'authenticated'
    || claims(ownerAccessToken).client_id != null) throw safeError()
  if (typeof publicApiKey !== 'string' || publicApiKey.length > 8192 || /[\r\n]/.test(publicApiKey)
    || !(publicApiKey.startsWith('sb_publishable_') || claims(publicApiKey).role === 'anon')) throw safeError()
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000) throw safeError()
  return async (route, method = 'GET', body) => {
    if (!(route === '/auth/v1/user' || route.startsWith('/rest/v1/'))) throw safeError()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await send(`${BASE}${route}`, {
        method, redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { apikey: publicApiKey, Authorization: `Bearer ${ownerAccessToken}`,
          'Content-Type': 'application/json', Prefer: 'return=representation' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      if (!response.ok || response.redirected) { await response.body?.cancel(); throw safeError() }
      const reader = response.body?.getReader()
      if (!reader) return null
      try {
        let size = 0
        const chunks = []
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.length
          if (size > 16_384) throw safeError()
          chunks.push(value)
        }
        const text = Buffer.concat(chunks).toString('utf8')
        return text.trim() ? JSON.parse(text) : null
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    } catch { throw safeError() }
    finally { clearTimeout(timer) }
  }
}

function validState(state) {
  if (state.marker !== MARKER || !UUID.test(state.projectId) || !UUID.test(state.userId)
    || !/^TrackQA synthetic pilot [0-9a-f-]{36}$/.test(state.clientLabel)
    || (state.connectionId != null && !UUID.test(state.connectionId))) throw safeError()
}
const projectRoute = id => `/rest/v1/projects?id=eq.${id}&select=id,name,mcp_enabled,archived`
const connectionRoute = state => '/rest/v1/mcp_connections?'
  + `project_id=eq.${state.projectId}&user_id=eq.${state.userId}&client_label=eq.${encodeURIComponent(state.clientLabel)}`
  + '&select=id,revoked_at&limit=2'

export async function cleanup({ store, api }) {
  const state = await store.readState()
  if (state.marker !== MARKER) throw safeError()
  let localRemoved = false
  let revoked = false
  let disabled = false
  // Remove the local credential even when network access or Owner auth fails.
  try { await store.removeConfig(); localRemoved = true } catch { /* report below */ }
  if (state.phase === 'prepared') return { localRemoved, revoked: null, disabled: null, localOnly: true, complete: localRemoved }
  validState(state)
  let fixture = false
  try {
    const rows = await api(projectRoute(state.projectId))
    fixture = rows.length === 1 && rows[0].id === state.projectId && rows[0].name === 'MCP Synthetic Pilot'
  } catch { /* No remote writes until the expected fixture is established. */ }
  if (!fixture) {
    await store.writeState({ ...state, phase: 'cleanup_required', localRemoved, revoked, disabled })
    return { localRemoved, revoked, disabled, complete: false }
  }
  try {
    const rows = await api(connectionRoute(state))
    if (!Array.isArray(rows) || rows.length > 1) throw safeError()
    const id = state.connectionId ?? rows[0]?.id
    if (id && (!UUID.test(id) || rows.length !== 1 || rows[0].id !== id)) throw safeError()
    if (id) {
      await api('/rest/v1/rpc/revoke_mcp_connection', 'POST', { p_connection_id: id })
      const checked = await api(connectionRoute(state))
      revoked = checked.length === 1 && checked[0].id === id && Boolean(checked[0].revoked_at)
    }
  } catch { /* Still attempt project disablement independently. */ }
  try {
    await api(projectRoute(state.projectId), 'PATCH', { mcp_enabled: false })
    const rows = await api(projectRoute(state.projectId))
    disabled = rows.length === 1 && rows[0].id === state.projectId && rows[0].mcp_enabled === false
  } catch { /* A failed/uncertain result must remain visible in the record. */ }
  const complete = localRemoved && revoked && disabled
  await store.writeState({ ...state, phase: complete ? 'cleaned' : 'cleanup_required', localRemoved, revoked, disabled })
  return { localRemoved, revoked, disabled, complete }
}

export async function issue({ store, api, projectId, storageReviewed, fixtureReviewed, interrupted = () => false }) {
  if (!storageReviewed || !fixtureReviewed || !UUID.test(projectId)) throw safeError()
  const previous = await store.readState()
  if (previous.marker !== MARKER || previous.phase !== 'prepared'
    || JSON.stringify(await store.readConfig()) !== JSON.stringify(disabledConfig())) throw safeError()
  const user = await api('/auth/v1/user')
  if (!UUID.test(user?.id)) throw safeError()
  const members = await api(`/rest/v1/project_members?project_id=eq.${projectId}&user_id=eq.${user.id}&select=role&limit=2`)
  const projects = await api(projectRoute(projectId))
  if (members.length !== 1 || members[0].role !== 'OWNER' || projects.length !== 1
    || projects[0].id !== projectId || projects[0].name !== 'MCP Synthetic Pilot'
    || !projects[0].mcp_enabled || projects[0].archived || interrupted()) throw safeError()
  const state = { marker: MARKER, phase: 'issuance_uncertain', projectId, userId: user.id,
    clientLabel: `TrackQA synthetic pilot ${randomUUID()}`, connectionId: null }
  await store.writeState(state)
  try {
    if (interrupted()) throw safeError()
    const rows = await api('/rest/v1/rpc/issue_mcp_connection_token', 'POST', {
      p_project_id: projectId, p_user_id: user.id, p_client_label: state.clientLabel,
    })
    if (!Array.isArray(rows) || rows.length !== 1 || !UUID.test(rows[0]?.connection_id)) throw safeError()
    state.connectionId = rows[0].connection_id
    await store.writeState(state)
    if (!TOKEN.test(rows[0].access_token) || interrupted()) throw safeError()
    await store.writeConfig(disabledConfig(rows[0].access_token))
    rows[0].access_token = null
    if (interrupted()) throw safeError()
    await store.writeState({ ...state, phase: 'issued_disabled' })
    // Metadata only. The raw token is deliberately not a function result.
    return { connectionId: state.connectionId, disabled: true }
  } catch {
    try { await cleanup({ store, api }) } catch { /* Recovery record retained. */ }
    throw safeError()
  }
}

// Windows launcher supplies bounded JSON over redirected stdin, never argv/env.
// Importing this module for tests does not read stdin, files or the network.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Dependencies may diagnose Auth failures internally. Never forward those
  // messages; this entry emits only our own fixed errors/metadata via stdout.
  for (const name of ['log', 'warn', 'error', 'debug', 'info']) console[name] = () => {}
  let interrupted = false
  const stop = new AbortController()
  process.on('SIGINT', () => { interrupted = true; stop.abort() })
  process.on('SIGTERM', () => { interrupted = true; stop.abort() })
  try {
    if (process.argv.length !== 2) throw safeError()
    let input = ''
    for await (const chunk of process.stdin) {
      input += chunk
      if (Buffer.byteLength(input) > 24_576) throw safeError()
    }
    const options = JSON.parse(input)
    input = ''
    const root = path.join(process.env.LOCALAPPDATA, 'TrackQA-MCP-Pilot')
    const store = createStore(root)
    if (options.mode === 'Prepare') {
      await store.prepare()
      process.stdout.write('Prepared: disabled configuration; no credentials or network access.\n')
    } else {
      if (!['Auth', 'Issue', 'Cleanup'].includes(options.mode) || options.projectId !== FIXTURE_PROJECT_ID) throw new OwnerAuthError('configuration')
      const state = await store.readState()
      if (state.projectId && state.projectId !== options.projectId) throw new OwnerAuthError('project_mismatch')
      const wrapped = await withOwnerAuthentication({ ...options,
        makeApi: credentials => createHumanApi(credentials), interrupted: () => interrupted, signal: stop.signal,
      }, async api => options.mode === 'Issue'
        ? issue({ ...options, store, api, interrupted: () => interrupted })
        : options.mode === 'Cleanup' ? cleanup({ store, api }) : undefined)
      const result = options.mode === 'Auth' ? wrapped.authentication : wrapped.operation
      process.stdout.write(JSON.stringify(result) + '\n')
      if (result.complete === false) process.exitCode = 1
    }
  } catch (error) {
    if (error instanceof OwnerAuthError) process.stdout.write(JSON.stringify(authenticationFailure(error)) + '\n')
    else process.stderr.write(safeError().message + '\n')
    process.exitCode = 1
  }
}
