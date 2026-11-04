import { lstat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { ConnectorError, requireValue, setupFor, UUID } from '../core.ts'
import type { Owner } from '../auth.ts'
import type { Adapter } from '../clients/adapter.ts'
import type { VSCodeExecutable } from '../clients/vscode.ts'
import type { CopilotRuntime } from '../clients/vscode-copilot-lifecycle.ts'
import { startCopilotSession } from '../clients/vscode-copilot-lifecycle.ts'
import { vscodeCopilotAdapter } from '../clients/vscode-copilot.ts'
import { copilotPaths } from '../clients/vscode-copilot-session.ts'
import { readVSCodeFile, safeVSCodeDirectory, writeVSCodeFile } from '../clients/vscode-session.ts'
import { fingerprint } from '../clients/codex.ts'
import type { Store } from '../state.ts'
import { recordHome } from '../state.ts'
import { connectCopilotFixture, disconnect, ownerProject } from '../workflow.ts'
import type { UI } from '../workflow.ts'
import { COPILOT_FIXTURE as fixture, FIXTURE_POLICY, enableFixtureRecovery, fixtureScopeState,
  grantFixturePermit, inventoryRoute, requireFixtureActive, unrevokedRoute } from './copilot-fixture-scope.ts'
import type { FixtureScope } from './copilot-fixture-scope.ts'
import { copilotHostedPathBudget, freshHostedCopilotHome, hostedCopilotRecoveryHome } from './copilot-hosted-paths.ts'
import { HostedAcceptanceTiming } from './copilot-hosted-timing.ts'

type Inventory = { count: number; hash: string }
type Baseline = { issues: Inventory; findings: Inventory }
type Journal = { owner: 'TrackQA Copilot fixture acceptance v1'; projectId: string; userId: string; home: string; originalMcpEnabled: false; baseline: Baseline }
const journalPath = (store: Store) => path.join(store.root, 'copilot-fixture-acceptance.json')
const setup = setupFor(fixture.id, 'vscode-copilot')
const bytes = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + '\n')
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
  return value
}
async function inventory(owner: Owner, table: 'issues' | 'ai_findings'): Promise<Inventory> {
  const rows: { id: string; project_id: string }[] = []
  for (let offset = 0; offset <= 2000; offset += 100) {
    const page = await owner.api(inventoryRoute(table, offset))
    requireValue(Array.isArray(page) && page.length <= 100 && page.every(row => row && UUID.test(row.id) && row.project_id === fixture.id), 'fixture_inventory_unverified')
    rows.push(...page)
    requireValue(rows.length <= 2000 && new Set(rows.map(row => row.id)).size === rows.length, 'fixture_inventory_unverified')
    if (page.length < 100) return { count: rows.length, hash: fingerprint(canonical(rows.sort((a, b) => a.id.localeCompare(b.id)))) }
  }
  throw new ConnectorError('fixture_inventory_unverified')
}
async function exactProject(owner: Owner) {
  const project = await ownerProject(owner, fixture.id, true)
  requireValue(project.id === fixture.id && project.name === fixture.name && project.key === fixture.key, 'fixture_identity_mismatch')
  return project
}
async function zeroConnections(owner: Owner) {
  const rows = await owner.api(unrevokedRoute)
  requireValue(Array.isArray(rows) && rows.length === 0, 'fixture_connections_unverified')
}
async function snapshot(owner: Owner, preflight = false): Promise<Baseline> {
  const project = await exactProject(owner)
  requireValue(!project.mcp_enabled && (!preflight || !project.archived), 'fixture_baseline_unexpected')
  await zeroConnections(owner)
  return { issues: await inventory(owner, 'issues'), findings: await inventory(owner, 'ai_findings') }
}
export async function checkCopilotAcceptanceLocal(store: Store, recovery = false) {
  await safeVSCodeDirectory(store.root, true)
  const records = await store.read()
  requireValue(recovery || records.length === 0, 'existing_connection_recover_first')
  const saved = await readVSCodeFile(journalPath(store))
  requireValue(recovery ? !!saved : !saved, 'fixture_recovery_required')
}
// Recovery may need a profile made before the short-path correction. Resolve
// only the two connector-owned layouts; recovery never launches that profile.
export async function copilotHostedRecoveryBase(store: Store, legacyBase: string) {
  const saved = await readVSCodeFile(journalPath(store))
  requireValue(saved, 'fixture_recovery_required')
  let home: unknown
  try { home = JSON.parse(saved.toString('utf8')).home } catch { throw new ConnectorError('fixture_recovery_invalid') }
  requireValue(typeof home === 'string', 'fixture_recovery_invalid')
  for (const base of [store.root, legacyBase]) {
    try { if (home !== base) { hostedCopilotRecoveryHome(base, home); return base } } catch { /* Try only the other known layout. */ }
  }
  throw new ConnectorError('fixture_recovery_invalid')
}
function fixtureAdapter(exe: VSCodeExecutable, home: string, scope: FixtureScope, ui: UI,
  requestDisconnect: (signal: AbortSignal) => Promise<void>, timing: HostedAcceptanceTiming, runtime?: CopilotRuntime): Adapter {
  const base = vscodeCopilotAdapter(exe, home, { requestDisconnect, report: ui.say })
  const pin = (projectId: string) => requireValue(projectId === fixture.id, 'fixture_identity_mismatch')
  return { ...base,
    entry: async input => { pin(input.projectId); return base.entry(input) },
    install: async input => { requireFixtureActive(scope, input.projectId); return base.install(input) },
    remove: async (input, hash) => { pin(input.projectId); await base.remove(input, hash) },
    verify: async input => { requireFixtureActive(scope, input.projectId); return { authorized: null, verified: false, code: 'manual_verification_required' } },
    launch: async (input, token, signal) => {
      requireFixtureActive(scope, input.projectId)
      requireValue(fixtureScopeState(scope).issued, 'fixture_capability_invalid')
      timing.requireBudget('before_launch')
      timing.record('launch_start')
      const session = await startCopilotSession(exe, home, input, { credential: token, signal, runtime })
      token = ''
      try { await session.waitForDisconnect(requestDisconnect, signal) }
      finally {
        ui.say(`Acceptance launcher exit: ${session.launcherStatus()}. Detached Agent Host/SDK termination: UNVERIFIED. Use File > Exit only in TrackQA Copilot.`)
      }
    },
  }
}
function scopedUi(ui: UI, timing?: HostedAcceptanceTiming): UI {
  const allowed = new Set(['Install this token-free configuration?', `Enable MCP access for ${fixture.name} only?`,
    `Approve one connection for your account on ${fixture.name}? Default expiry is 90 days; revocation will be attempted when this session ends.`,
    'Launch for manual read-only verification?', `Remove the connector-owned configuration and revoke its connection for project ${fixture.id}?`])
  return { ...ui, confirm: async message => {
    requireValue(allowed.has(message), 'fixture_consent_mismatch')
    if (message.startsWith('Remove the connector-owned')) timing?.cleanupStart()
    // Recheck immediately before the existing enablement/issuance boundaries.
    // Removal/revocation must remain available after the deadline or a signal.
    else if (message.startsWith('Enable MCP access') || message.startsWith('Approve one connection')) timing?.requireBudget('before_mutation')
    return true
  } }
}
async function finish(owner: Owner, scope: FixtureScope, store: Store, journal: Journal, saved: Buffer, ui: UI) {
  const failures: string[] = []
  try {
    const project = await exactProject(owner)
    if (project.mcp_enabled) {
      requireValue(fixtureScopeState(scope).enabled || fixtureScopeState(scope).recovery, 'fixture_restoration_unconfirmed')
      const result = await owner.api(`/rest/v1/projects?id=eq.${fixture.id}&select=id,mcp_enabled`, 'PATCH', { mcp_enabled: false })
      requireValue(Array.isArray(result) && result.length === 1 && result[0].id === fixture.id && result[0].mcp_enabled === false, 'fixture_restoration_unconfirmed')
    }
    requireValue(!(await exactProject(owner)).mcp_enabled, 'fixture_restoration_unconfirmed')
    ui.say('Fixture MCP-disabled state independently verified.')
  } catch { failures.push('fixture_restoration_unconfirmed') }
  try { await zeroConnections(owner); ui.say('Zero unrevoked fixture connections verified.') } catch { failures.push('fixture_connections_unverified') }
  try {
    const after = { issues: await inventory(owner, 'issues'), findings: await inventory(owner, 'ai_findings') }
    requireValue(fingerprint(after) === fingerprint(journal.baseline), 'fixture_inventory_changed')
    ui.say('Issue/finding inventories unchanged (full-row digests).')
  } catch { failures.push('fixture_inventory_unverified') }
  try {
    requireValue((await store.read()).length === 0, 'cleanup_unconfirmed')
    requireValue(!await readVSCodeFile(copilotPaths(journal.home, setup).mcp), 'local_removal_unconfirmed')
  } catch { failures.push('connection_recovery_required') }
  if (failures.length) { ui.say(`Acceptance recovery retained: ${failures.join(', ')}. Keep ${journalPath(store)} and runtime profile data.`); throw new ConnectorError('fixture_cleanup_unconfirmed') }
  requireValue((await readVSCodeFile(journalPath(store)))?.equals(saved), 'fixture_recovery_changed')
  await unlink(journalPath(store))
}
export async function runCopilotHostedAcceptance(options: { owner: Owner; scope: FixtureScope; store: Store; homeBase: string;
  exe: VSCodeExecutable; ui: UI; requestDisconnect: (signal: AbortSignal) => Promise<void>; signal?: AbortSignal; runtime?: CopilotRuntime;
  timing?: HostedAcceptanceTiming }) {
  const timing = options.timing ?? new HostedAcceptanceTiming({ signal: options.signal })
  try { return await runTimedAcceptance(options, timing) }
  catch (error) { throw timing.classify(error) }
  finally { if (!options.timing) timing.dispose() }
}
async function runTimedAcceptance(options: Parameters<typeof runCopilotHostedAcceptance>[0], timing: HostedAcceptanceTiming) {
  const { owner, scope, store, ui } = options
  timing.check()
  requireValue(!fixtureScopeState(scope).active, 'fixture_capability_invalid')
  const home = freshHostedCopilotHome(options.homeBase)
  copilotHostedPathBudget(home) // Also protects direct internal callers before any hosted read/write.
  await checkCopilotAcceptanceLocal(store)
  const adapter = fixtureAdapter(options.exe, home, scope, ui, options.requestDisconnect, timing, options.runtime)
  requireValue(await adapter.entry(setup) === null, 'configuration_conflict')
  timing.record('preflight_start', { phase: 'initial' })
  timing.check()
  const before = await snapshot(owner, true)
  timing.record('preflight_complete', { phase: 'initial' })
  timing.establishDeadline() // Same anchor as before: first completed fixture preflight.
  ui.say(`Pinned target: ${fixture.name} [${fixture.key}] ${fixture.id}; MCP=false; zero unrevoked connections. Issues=${before.issues.count}; findings=${before.findings.count}.`)
  ui.say(FIXTURE_POLICY)
  timing.record('approval_requested')
  timing.check()
  const approved = await ui.confirm('Approve this revised policy, temporary enablement of only MCP Synthetic Pilot, and exactly one connection (existing 90-day expiry unchanged), followed by revocation, disabled-state restoration and inventory checks?') === true
  timing.record('approval_received', { approved })
  timing.check()
  if (!approved) return { approved: false }
  // Recheck after the human delay. A stale preflight is not authorization.
  timing.record('preflight_start', { phase: 'repeat' })
  requireValue(fingerprint(await snapshot(owner, true)) === fingerprint(before), 'fixture_preflight_changed')
  timing.record('preflight_complete', { phase: 'repeat' })
  await checkCopilotAcceptanceLocal(store)
  requireValue(await adapter.entry(setup) === null && !await lstat(copilotPaths(home, setup).root).catch(e => { if (e.code === 'ENOENT') return null; throw e }), 'configuration_conflict')
  const journal: Journal = { owner: 'TrackQA Copilot fixture acceptance v1', projectId: fixture.id, userId: owner.userId, home, originalMcpEnabled: false, baseline: before }
  timing.requireBudget('before_mutation')
  const saved = bytes(journal)
  await writeVSCodeFile(journalPath(store), saved) // Durable before any hosted write.
  const permit = grantFixturePermit(scope, owner, adapter, store)
  let failure: unknown
  try { await connectCopilotFixture({ owner, adapter, store, ui: scopedUi(ui, timing), permit, signal: timing.signal }) }
  catch (error) { failure = error }
  finally {
    timing.cleanupStart()
    try { await finish(owner, scope, store, journal, saved, ui); timing.cleanupComplete(true) }
    catch (error) { failure = error; timing.cleanupComplete(false) }
  }
  if (failure) throw failure
  timing.check() // A signal during cleanup is reported after cleanup finishes.
  return { approved: true }
}
export async function recoverCopilotHostedAcceptance(options: { owner: Owner; scope: FixtureScope; store: Store; homeBase: string; ui: UI }) {
  const { owner, scope, store, ui } = options
  await checkCopilotAcceptanceLocal(store, true)
  const saved = (await readVSCodeFile(journalPath(store)))!
  let journal: Journal
  try { journal = JSON.parse(saved.toString('utf8')) } catch { throw new ConnectorError('fixture_recovery_invalid') }
  requireValue(journal.owner === 'TrackQA Copilot fixture acceptance v1' && journal.projectId === fixture.id && journal.userId === owner.userId
    && UUID.test(journal.userId) && journal.originalMcpEnabled === false && Object.keys(journal).length === 6
    && typeof journal.home === 'string' && journal.home !== options.homeBase
    && !!journal.baseline && Object.keys(journal.baseline).length === 2
    && [journal.baseline.issues, journal.baseline.findings].every(item => item && Object.keys(item).length === 2 && Number.isInteger(item.count) && item.count >= 0 && item.count <= 2000 && /^[a-f0-9]{64}$/.test(item.hash)), 'fixture_recovery_invalid')
  hostedCopilotRecoveryHome(options.homeBase, journal.home)
  const records = await store.read()
  requireValue(records.length <= 1 && records.every(record => record.client === 'vscode-copilot' && record.projectId === fixture.id && record.userId === owner.userId && recordHome(record) === journal.home), 'fixture_recovery_invalid')
  await exactProject(owner)
  const live = await owner.api(unrevokedRoute)
  requireValue(Array.isArray(live) && live.length <= 1 && live.every(row => records[0] && row.project_id === fixture.id && row.user_id === owner.userId
    && row.client_label === records[0].clientLabel && (records[0].connectionId === null || row.id === records[0].connectionId)), 'fixture_recovery_conflict')
  requireValue(await ui.confirm('Recover only this saved fixture acceptance: revoke its connection, restore MCP=false, remove unchanged MCP configuration and verify inventories? No new connection will be issued.'), 'fixture_recovery_declined')
  enableFixtureRecovery(scope, records[0])
  let failure: unknown
  if (records[0]) {
    const file = records[0].executable
    const adapter = vscodeCopilotAdapter({ path: file, sha256: '', version: 'recovery-only', inputs: [], installation: path.dirname(file), appServer: false, foregroundMode: 'direct' }, journal.home, { requestDisconnect: async () => {}, report: ui.say })
    try { await disconnect(store, adapter, scopedUi(ui), async action => action(owner), fixture.id) } catch (error) { failure = error }
  }
  try { await finish(owner, scope, store, journal, saved, ui) } catch (error) { failure = error }
  if (failure) throw failure
}
