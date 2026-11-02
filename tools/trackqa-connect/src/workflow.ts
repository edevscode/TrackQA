import { randomUUID } from 'node:crypto'
import { ConnectorError, display, requireValue, setupFor, TOKEN, UUID } from './core.ts'
import type { Project, Setup } from './core.ts'
import type { Owner } from './auth.ts'
import type { Adapter } from './clients/adapter.ts'
import { adapterClient, adapterHome, adapterLabel } from './clients/adapter.ts'
import { fingerprint, matchesEntry } from './clients/codex.ts'
import type { Store, RecordState } from './state.ts'
import { recordHome } from './state.ts'

export type UI = {
  say: (message: string) => void
  confirm: (message: string) => Promise<boolean>
  choose: (message: string, choices: string[]) => Promise<number>
}
export async function ownerProject(owner: Owner, id: string, archivedAllowed = false): Promise<Project> {
  requireValue(UUID.test(id), 'project_unavailable')
  const membership = await owner.api(`/rest/v1/project_members?project_id=eq.${id}&user_id=eq.${owner.userId}&select=user_id,role&limit=2`)
  const rows = await owner.api(`/rest/v1/projects?id=eq.${id}&select=id,name,key,mcp_enabled,archived&limit=2`)
  requireValue(Array.isArray(membership) && membership.length === 1 && membership[0].user_id === owner.userId && membership[0].role === 'OWNER', 'owner_required')
  requireValue(Array.isArray(rows) && rows.length === 1 && rows[0].id === id && typeof rows[0].mcp_enabled === 'boolean'
    && typeof rows[0].name === 'string' && typeof rows[0].key === 'string' && typeof rows[0].archived === 'boolean'
    && (archivedAllowed || !rows[0].archived), 'project_unavailable')
  return rows[0]
}
export async function chooseProject(owner: Owner, ui: UI, requested?: string) {
  const projects = owner.projects
  requireValue(projects.length, 'no_eligible_owner_projects')
  const id = requested ?? projects[await ui.choose('Choose a project you own', projects.map(project => `${display(project.name)} [${display(project.key)}]`))]?.id
  requireValue(id && projects.some(project => project.id === id), 'project_unavailable')
  return ownerProject(owner, id)
}
export function preview(setup: Setup, adapter: Adapter) {
  const command = adapter.installPreview?.(setup) ?? `codex mcp add ${setup.serverName} --url ${setup.endpoint} --bearer-token-env-var ${setup.envVar}`
  return `Client: ${adapterLabel(adapter)} CLI ${adapter.executable.version}\nProject: ${setup.projectId}\nConfig: ${display(adapterHome(adapter))}\nServer: ${setup.serverName}\nEndpoint: ${setup.endpoint}\nAuthentication: environment reference ${setup.envVar} (no token saved)\nInstallation method (preview only): ${command}\nUnrelated MCP entries will be preserved.`
}
async function remoteCleanup(owner: Owner, record: RecordState) {
  await ownerProject(owner, record.projectId, true)
  if (!['issuing', 'active', 'revocation_pending', 'revoked'].includes(record.phase)) return
  const filter = record.connectionId ? `id=eq.${record.connectionId}` : `client_label=eq.${encodeURIComponent(record.clientLabel)}&user_id=eq.${record.userId}`
  const route = `/rest/v1/mcp_connections?project_id=eq.${record.projectId}&${filter}&select=id,project_id,user_id,client_label,revoked_at&limit=2`
  let rows = await owner.api(route)
  requireValue(Array.isArray(rows) && rows.length <= 1 && rows.every(row => UUID.test(row.id) && row.project_id === record.projectId && row.user_id === record.userId
    && (record.connectionId ? row.id === record.connectionId : row.client_label === record.clientLabel)), 'revocation_unconfirmed')
  // A timed-out issuance may still commit later. Absence alone cannot settle it.
  requireValue(record.connectionId || rows.length === 1, 'issuance_outcome_unknown')
  if (!rows.length) return // Known ID absent; it cannot resolve to a live connection.
  record.connectionId = rows[0].id
  if (!rows[0].revoked_at) {
    await owner.api('/rest/v1/rpc/revoke_mcp_connection', 'POST', { p_connection_id: record.connectionId })
    rows = await owner.api(route)
    requireValue(Array.isArray(rows) && rows.length <= 1 && rows.every(row => row.id === record.connectionId && row.project_id === record.projectId && !!row.revoked_at), 'revocation_unconfirmed')
  }
}
export async function cleanup(store: Store, adapter: Adapter, record: RecordState, owner?: Owner) {
  requireValue(record.client === adapterClient(adapter) && recordHome(record) === adapterHome(adapter), 'configuration_home_mismatch')
  const unresolved: string[] = []
  const needsRevocation = ['issuing', 'active', 'revocation_pending'].includes(record.phase)
  if (needsRevocation) {
    try {
      requireValue(owner, 'owner_signin_required')
      await remoteCleanup(owner, record)
      record.phase = 'revoked'
      await store.save(record)
    } catch { record.phase = 'revocation_pending'; unresolved.push('revocation_unconfirmed') }
  }
  try {
    await adapter.remove(setupFor(record.projectId, record.client), record.configHash)
    record.installed = false
  } catch { unresolved.push('local_removal_unconfirmed') }
  if (unresolved.length) await store.save(record)
  else await store.remove(record.projectId, record.client)
  return { revoked: !needsRevocation || record.phase === 'revoked', removed: !record.installed && !unresolved.includes('local_removal_unconfirmed'), unresolved }
}
export async function connect({ owner, adapter, store, ui, projectId, signal }: {
  owner: Owner; adapter: Adapter; store: Store; ui: UI; projectId?: string; signal?: AbortSignal
}) {
  const project = await chooseProject(owner, ui, projectId)
  const client = adapterClient(adapter)
  const setup = setupFor(project.id, client)
  const records = await store.read()
  requireValue(!records.some(record => record.projectId === project.id && record.client === client), 'existing_connection_recover_first')
  requireValue(await adapter.entry(setup) === null, 'configuration_conflict')
  ui.say(preview(setup, adapter))
  ui.say('The token will be available only to this foreground session. Other trusted processes on this OS account may inspect its environment. A normal future client launch will not inherit it.')
  if (!await ui.confirm('Install this token-free configuration?')) return
  requireValue(!signal?.aborted, 'interrupted')
  const record: RecordState = { projectId: project.id, userId: owner.userId, client, executable: adapter.executable.path,
    ...(client === 'claude' ? { claudeHome: adapterHome(adapter) } : client === 'gemini' ? { geminiHome: adapterHome(adapter) } : { codexHome: adapterHome(adapter) }), clientLabel: `TrackQA Connect ${randomUUID()}`, connectionId: null,
    phase: 'planned', installed: false, configHash: null, lastVerifiedAt: null }
  await store.save(record)
  let token = ''
  let failure: unknown
  const run = async () => {
    record.configHash = await adapter.install(setup)
    record.installed = true; record.phase = 'installed'; await store.save(record)
    let current = await ownerProject(owner, project.id)
    if (!current.mcp_enabled) {
      ui.say('Enabling project access can also restore other eligible connections. This setting remains enabled after your session; only this session’s token will be revoked automatically.')
      if (!await ui.confirm(`Enable MCP access for ${display(current.name)} only?`)) return
      requireValue(!signal?.aborted, 'interrupted')
      const result = await owner.api(`/rest/v1/projects?id=eq.${project.id}&select=id,mcp_enabled`, 'PATCH', { mcp_enabled: true })
      requireValue(Array.isArray(result) && result.length === 1 && result[0].id === project.id && result[0].mcp_enabled === true, 'enablement_unconfirmed')
      current = await ownerProject(owner, project.id)
    }
    requireValue(current.mcp_enabled && !signal?.aborted, 'project_unavailable')
    if (!await ui.confirm(`Approve one connection for your account on ${display(current.name)}? Default expiry is 90 days; revocation will be attempted when this session ends.`)) return
    requireValue(!signal?.aborted, 'interrupted')
    record.phase = 'issuing'; await store.save(record)
    const rows = await owner.api('/rest/v1/rpc/issue_mcp_connection_token', 'POST', { p_project_id: project.id, p_user_id: owner.userId, p_client_label: record.clientLabel })
    try {
      requireValue(Array.isArray(rows) && rows.length === 1 && UUID.test(rows[0].connection_id), 'issuance_unconfirmed')
      record.connectionId = rows[0].connection_id
      await store.save(record)
      requireValue(TOKEN.test(rows[0].access_token), 'issuance_unconfirmed')
      token = rows[0].access_token
    } finally { if (Array.isArray(rows)) rows.forEach(row => { if (row && typeof row === 'object') row.access_token = '' }) }
    record.phase = 'active'; await store.save(record)
    requireValue(!signal?.aborted, 'interrupted')
    const verification = await adapter.verify(setup, token, signal)
    ui.say(`Configured: yes. Authorized: ${verification.authorized === true ? 'verified' : 'not verified'}. Verified working: ${verification.verified ? 'yes' : 'no'}.`)
    if (verification.code === 'manual_verification_required') {
      ui.say(adapter.manualInstructions?.(setup) ?? `Automatic client verification is unavailable. In Codex, use /mcp and call trackqa_connection_status and trackqa_list_projects; confirm only project ${project.id}. Do not submit a finding. The CLI will keep the result unverified.`)
      if (!await ui.confirm('Launch for manual read-only verification?')) return
    } else requireValue(verification.verified, verification.code)
    if (verification.verified) { record.lastVerifiedAt = new Date().toISOString(); await store.save(record) }
    requireValue(!signal?.aborted, 'interrupted')
    ui.say(`Launching ${adapterLabel(adapter)}. Exit normally to return here for token revocation and configuration cleanup.`)
    await adapter.launch(setup, token, signal)
  }
  try { await run() } catch (error) { failure = error }
  finally {
    token = ''
    const result = await cleanup(store, adapter, record, owner)
    ui.say(`Session cleanup: local configuration ${result.removed ? 'removed' : 'UNCONFIRMED'}; remote revocation ${result.revoked ? 'confirmed or not needed' : 'UNCONFIRMED'}.`)
    if (result.unresolved.length) {
      if (client === 'gemini') ui.say('Preserve settings.json and any .trackqa-settings-recovery-*.bak in the Gemini home. Compare/merge before recovery; never restore over an unexpected external edit or retry an uncertain write automatically.')
      ui.say(`Recovery required: run disconnect --client ${client} --project ${project.id}, or ask a project Owner to revoke the connection in Manage Connections. Keep the nonsecret recovery record. No token was saved.`)
      failure = new ConnectorError('cleanup_unconfirmed')
    }
  }
  if (failure) throw failure
}
export async function status(store: Store, adapter: Adapter, ui: UI, projectId?: string) {
  const records = (await store.read()).filter(record => record.client === adapterClient(adapter) && (!projectId || record.projectId === projectId))
  if (!records.length) { ui.say('No connector-managed configuration or recovery records. Authorized: not checked. Verified working: not checked.'); return }
  for (const record of records) {
    requireValue(recordHome(record) === adapterHome(adapter), 'configuration_home_mismatch')
    const setup = setupFor(record.projectId, record.client)
    const entry = await adapter.entry(setup)
    const configured = !!record.configHash && (adapter.matches ?? matchesEntry)(entry, setup) && fingerprint(entry) === record.configHash
    ui.say(`Project ${record.projectId}: Configured: ${configured ? 'yes' : entry ? 'changed; not managed safely' : 'no'}. Authorized: not checked. Verified working: not checked (no live session probe). Recovery: ${record.phase}. Last verified: ${record.lastVerifiedAt ?? 'never'}.`)
  }
}
export async function disconnect(store: Store, adapter: Adapter, ui: UI, authenticate: (action: (owner: Owner) => Promise<void>) => Promise<void>, projectId?: string) {
  const records = (await store.read()).filter(record => record.client === adapterClient(adapter) && (!projectId || record.projectId === projectId))
  requireValue(records.length, 'no_managed_connections')
  const record = records.length === 1 ? records[0] : records[await ui.choose('Choose a connection to remove', records.map(record => record.projectId))]
  requireValue(record && recordHome(record) === adapterHome(adapter), 'configuration_home_mismatch')
  if (!await ui.confirm(`Remove the connector-owned configuration and revoke its connection for project ${record.projectId}?`)) return
  let result, authenticationFailure: unknown
  if (!['issuing', 'active', 'revocation_pending'].includes(record.phase)) result = await cleanup(store, adapter, record)
  else {
    try { await authenticate(async owner => { result = await cleanup(store, adapter, record, owner) }) }
    catch (error) { authenticationFailure = error; result = await cleanup(store, adapter, record) }
  }
  requireValue(result, 'cleanup_unconfirmed')
  ui.say(`Disconnect: local configuration ${result.removed ? 'removed' : 'UNCONFIRMED'}; remote revocation ${result.revoked ? 'confirmed or not needed' : 'UNCONFIRMED'}.`)
  if (result.unresolved.length && adapterClient(adapter) === 'gemini') ui.say('Preserve settings.json, any .trackqa-settings-recovery-*.bak, and the nonsecret recovery record. Compare/merge before retrying local recovery; never reset the whole settings file.')
  if (result.unresolved.length) throw new ConnectorError('cleanup_unconfirmed')
  if (authenticationFailure) throw authenticationFailure
}
