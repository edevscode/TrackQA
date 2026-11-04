// Explicit local test infrastructure. Never called by the production CLI.
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { lstat, mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ConnectorError, requireValue, setupFor } from '../core.ts'
import type { Owner } from '../auth.ts'
import type { Adapter } from '../clients/adapter.ts'
import type { VSCodeExecutable } from '../clients/vscode.ts'
import { fingerprint } from '../clients/codex.ts'
import { copilotEnvironment, copilotLaunchArgs } from '../clients/vscode-copilot.ts'
import { copilotPaths, copilotPayloads, removeOwnedCopilotConfiguration } from '../clients/vscode-copilot-session.ts'
import { startPreparedCopilotSession } from '../clients/vscode-copilot-lifecycle.ts'
import type { CopilotRuntime } from '../clients/vscode-copilot-lifecycle.ts'
import { readVSCodeFile, safeVSCodeDirectory, writeVSCodeFile } from '../clients/vscode-session.ts'
import { Store } from '../state.ts'
import type { RecordState } from '../state.ts'
import { disconnect } from '../workflow.ts'
import type { UI } from '../workflow.ts'

const bytes = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + '\n')
export function loopbackEndpoint(value: string) {
  requireValue(/^http:\/\/(127\.0\.0\.1|\[::1\]):([1-9][0-9]{0,4})\/mcp$/.test(value), 'synthetic_loopback_required')
  const url = new URL(value)
  requireValue(Number(url.port) > 0 && Number(url.port) <= 65535, 'synthetic_loopback_required')
  return url
}
export function syntheticConfiguration(endpoint: string, envVar: string, name: string) {
  loopbackEndpoint(endpoint)
  requireValue(/^TRACKQA_SYNTHETIC_[A-F0-9]{32}$/.test(envVar)
    && /^trackqaSynthetic_[a-f0-9]{32}$/.test(name), 'synthetic_configuration_invalid')
  return { mcpServers: { [name]: { type: 'http', url: endpoint, headers: { Authorization: `Bearer \${${envVar}}` } } } }
}
export function validateSyntheticConfiguration(value: unknown, endpoint: string, envVar: string, name: string) {
  requireValue(fingerprint(value) === fingerprint(syntheticConfiguration(endpoint, envVar, name)), 'synthetic_configuration_invalid')
}
// Do not follow even a loopback redirect. A native client sees only our owned
// server, which has no redirect route and never returns a Location header.
export async function verifySyntheticRejection(endpoint: string, credential: string) {
  loopbackEndpoint(endpoint)
  try {
    const response = await fetch(endpoint, { method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store',
      signal: AbortSignal.timeout(3000), headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'revocation-check', method: 'tools/list', params: {} }) })
    await response.body?.cancel()
    requireValue(response.status === 401 && !response.redirected && response.url === endpoint, 'synthetic_revocation_unconfirmed')
  } catch { throw new ConnectorError('synthetic_revocation_unconfirmed') }
}

export async function createCopilotSyntheticFixture(options: {
  mode: 'loopback-synthetic'; host?: '127.0.0.1' | '::1'; report?: (message: string) => void
}) {
  requireValue(options?.mode === 'loopback-synthetic' && (options.host === undefined || ['127.0.0.1', '::1'].includes(options.host)), 'synthetic_mode_required')
  const host = options.host ?? '127.0.0.1', projectId = randomUUID(), userId = randomUUID(), connectionId = randomUUID()
  const id = randomBytes(16).toString('hex'), envVar = `TRACKQA_SYNTHETIC_${id.toUpperCase()}`, name = `trackqaSynthetic_${id}`
  const credential = `synthetic_${randomBytes(32).toString('hex')}`
  const root = await mkdtemp(path.join(os.tmpdir(), 'trackqa-copilot-synthetic-'))
  const home = path.join(root, 'profiles'), canonical = setupFor(projectId, 'vscode-copilot'), files = copilotPaths(home, canonical)
  const store = new Store(path.join(root, 'recovery'))
  let revoked = false, rejectionVerified = false
  const stats = { requests: 0, matchingHeaders: 0, initialize: 0, toolsList: 0, toolCalls: 0, revokedRejections: 0 }
  const tool = { name: 'synthetic_status', description: 'Harmless loopback-only status check',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false } }
  const server = createServer(async (req, res) => {
    stats.requests++
    const fail = (status: number) => { res.writeHead(status, { 'Cache-Control': 'no-store' }); res.end() }
    try {
      if (req.headers.host !== new URL(endpoint).host || req.url !== '/mcp') return fail(400)
      const header = req.headers.authorization ?? '', expected = `Bearer ${credential}`
      if (header.length !== expected.length || !timingSafeEqual(Buffer.from(header), Buffer.from(expected))) return fail(401)
      if (revoked) { stats.revokedRejections++; return fail(401) }
      stats.matchingHeaders++ // Excludes the controller's post-revocation probe.
      if (req.method === 'DELETE') return fail(204)
      if (req.method !== 'POST') return fail(405)
      let size = 0; const chunks: Buffer[] = []
      for await (const chunk of req) { size += chunk.length; if (size > 16384) return fail(413); chunks.push(chunk) }
      const message = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (message.method === 'notifications/initialized' && message.id === undefined) return fail(204)
      const reply = (result: unknown) => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
      }
      if (message.jsonrpc !== '2.0' || !['string', 'number'].includes(typeof message.id)) return fail(400)
      if (message.method === 'initialize') {
        if (!['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'].includes(message.params?.protocolVersion)) return fail(400)
        stats.initialize++; options.report?.('Synthetic MCP initialize received.')
        return reply({ protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'trackqa-loopback-synthetic', version: '1.0.0' } })
      }
      if (message.method === 'tools/list') { stats.toolsList++; options.report?.('Synthetic MCP tools/list received.'); return reply({ tools: [tool] }) }
      if (message.method === 'tools/call' && message.params?.name === tool.name
        && fingerprint(message.params.arguments) === fingerprint({}) && stats.toolCalls === 0) {
        stats.toolCalls++; options.report?.('Synthetic MCP tool invoked once.')
        return reply({ content: [{ type: 'text', text: 'TRACKQA_SYNTHETIC_OK' }], isError: false })
      }
      return fail(400) // No other tools, redirects, proxying, resources or writes.
    } catch { if (!res.headersSent) fail(400); else res.end() }
  })
  server.requestTimeout = 5000; server.headersTimeout = 5000
  let endpoint = ''
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen({ host, port: 0, exclusive: true }, resolve) })
  const address = server.address()
  requireValue(address && typeof address !== 'string' && address.address === host, 'synthetic_loopback_required')
  endpoint = `http://${host === '::1' ? '[::1]' : host}:${address.port}/mcp`
  const config = syntheticConfiguration(endpoint, envVar, name), mcp = bytes(config)
  const ownerBytes = bytes({ owner: 'TrackQA Copilot loopback synthetic v1', projectId, endpoint, envVar, name })
  const settings = copilotPayloads(canonical, 'token-free').settings
  async function validateOwned() {
    for (const dir of [root, home, files.root, files.user, path.dirname(files.settings), files.extensions, files.home, files.temp, files.copilot, files.shared]) await safeVSCodeDirectory(dir)
    requireValue((await readVSCodeFile(files.owner))?.equals(ownerBytes), 'configuration_conflict')
    requireValue(!await lstat(files.localMcp).catch(e => { if (e.code === 'ENOENT') return null; throw e }), 'configuration_conflict')
    requireValue(!await readVSCodeFile(files.process), 'copilot_process_unconfirmed')
    const value = await readVSCodeFile(files.mcp)
    if (value) {
      requireValue(value.equals(mcp), 'configuration_changed')
      validateSyntheticConfiguration(JSON.parse(value.toString('utf8')), endpoint, envVar, name)
    }
    return value
  }
  const record: RecordState = { projectId, userId, client: 'vscode-copilot', vscodeCopilotHome: home,
    executable: path.join(root, 'synthetic-Code.exe'), clientLabel: `TrackQA Connect ${randomUUID()}`, connectionId,
    phase: 'planned', installed: false, configHash: fingerprint(config.mcpServers[name]), lastVerifiedAt: null }
  try {
    await store.save(record)
    for (const dir of [home, files.root, files.user, path.dirname(files.settings), files.extensions, files.home, files.temp, files.copilot, files.shared,
      path.join(files.home, 'AppData', 'Roaming'), path.join(files.home, 'AppData', 'Local')]) await safeVSCodeDirectory(dir, true)
    await writeVSCodeFile(files.owner, ownerBytes)
    await writeVSCodeFile(files.settings, settings)
    await writeVSCodeFile(files.mcp, mcp)
    await validateOwned()
    record.installed = true; record.phase = 'active'; await store.save(record)
  } catch (failure) {
    await new Promise<void>(resolve => server.close(() => resolve()))
    throw failure // Preserve owned files/evidence, never delete on uncertain preparation.
  }
  const owner: Owner = { userId, projects: [], api: async (route, method = 'GET', body) => {
    // This closure implements only the shared Disconnect workflow's local fixture
    // operations. It never resolves a Supabase URL or authenticates an account.
    if (method === 'GET' && route === `/rest/v1/project_members?project_id=eq.${projectId}&user_id=eq.${userId}&select=user_id,role&limit=2`) return [{ user_id: userId, role: 'OWNER' }]
    if (method === 'GET' && route === `/rest/v1/projects?id=eq.${projectId}&select=id,name,key,mcp_enabled,archived&limit=2`) return [{ id: projectId, name: 'Loopback synthetic fixture', key: 'SYNTHETIC', mcp_enabled: true, archived: false }]
    if (method === 'GET' && route === `/rest/v1/mcp_connections?project_id=eq.${projectId}&id=eq.${connectionId}&select=id,project_id,user_id,client_label,revoked_at&limit=2`) {
      if (revoked) { await verifySyntheticRejection(endpoint, credential); rejectionVerified = true }
      return [{ id: connectionId, project_id: projectId, user_id: userId, client_label: record.clientLabel, revoked_at: revoked ? 'synthetic-revoked' : null }]
    }
    requireValue(method === 'POST' && route === '/rest/v1/rpc/revoke_mcp_connection'
      && fingerprint(body) === fingerprint({ p_connection_id: connectionId }), 'synthetic_operation_denied')
    revoked = true; return null
  } }
  const adapter: Adapter = {
    client: 'vscode-copilot', label: 'Loopback synthetic Copilot', configurationHome: home,
    executable: { path: record.executable, sha256: '', version: 'synthetic', appServer: false, foregroundMode: 'direct' },
    entry: async () => await validateOwned() ? config.mcpServers[name] : null,
    install: async () => { throw new ConnectorError('synthetic_single_use') },
    launch: async () => { throw new ConnectorError('synthetic_explicit_launch_required') },
    verify: async () => ({ authorized: null, verified: false, code: 'manual_verification_required' }),
    remove: async (setup, hash) => {
      requireValue(setup.projectId === projectId && hash === record.configHash, 'configuration_conflict')
      await validateOwned(); await removeOwnedCopilotConfiguration(files.mcp, mcp)
    },
  }
  return {
    root, home, files, endpoint, envVar, name, store,
    status: () => ({ ...stats, revoked, rejectionVerified, listenerActive: server.listening }),
    async launch(exe: VSCodeExecutable, launchOptions: { signal?: AbortSignal; runtime?: CopilotRuntime; source?: NodeJS.ProcessEnv } = {}) {
      requireValue(!revoked && !!await validateOwned(), 'configuration_changed')
      record.executable = exe.path; await store.save(record)
      return startPreparedCopilotSession(exe, { files, settings, args: copilotLaunchArgs(home, canonical),
        env: copilotEnvironment(home, canonical, launchOptions.source), envVar }, { ...launchOptions, credential })
    },
    async disconnect(ui: UI) { await disconnect(store, adapter, ui, async action => action(owner), projectId) },
    async close() {
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(new ConnectorError('synthetic_listener_cleanup_unconfirmed')) : resolve()))
    },
  }
}
