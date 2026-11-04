// Internal, fixed-fixture test capability. Normal connect never accepts this scope.
import { requireValue, UUID } from '../core.ts'
import type { Api } from '../core.ts'
import type { Owner } from '../auth.ts'
import type { Adapter } from '../clients/adapter.ts'
import { adapterClient, adapterHome } from '../clients/adapter.ts'
import type { Store } from '../state.ts'

export const COPILOT_FIXTURE = Object.freeze({ id: '5a759e3f-50b4-4fdd-b8ad-43469a7100c0', name: 'MCP Synthetic Pilot', key: 'MCPPILOT' })
export const FIXTURE_POLICY = 'Allow native tool_search_tool capability discovery, incidental tool references and necessary embedding-service use. Allow only trackqa_connection_status, trackqa_list_projects, trackqa_list_issues and trackqa_get_issue as application tools, once each. Prohibit trackqa_submit_finding, unrelated application tools, background/delegated agents and automatic tool approval. Discovery references are metadata, not execution authorization.'
export const unrevokedRoute = `/rest/v1/mcp_connections?project_id=eq.${COPILOT_FIXTURE.id}&revoked_at=is.null&select=id,project_id,user_id,client_label,revoked_at&limit=2`
export const inventoryRoute = (table: 'issues' | 'ai_findings', offset: number) => `/rest/v1/${table}?project_id=eq.${COPILOT_FIXTURE.id}&select=*&order=id.asc&limit=100&offset=${offset}`
declare const scopeBrand: unique symbol
declare const permitBrand: unique symbol
export type FixtureScope = { readonly [scopeBrand]: true }
export type FixturePermit = { readonly [permitBrand]: true }
type State = { active: boolean; recovery: boolean; enabled: boolean; issued: boolean; granted?: boolean; label?: string; connectionId?: string }
const scopes = new WeakMap<object, State>()
const permits = new WeakMap<object, { scope: FixtureScope; owner: Owner; adapter: Adapter; store: Store; used: boolean; expires: number }>()
export function createFixtureScope(): FixtureScope {
  const scope = Object.freeze({}) as FixtureScope
  scopes.set(scope, { active: false, recovery: false, enabled: false, issued: false }); return scope
}
function getState(scope: FixtureScope) {
  const state = scopes.get(scope); requireValue(state, 'fixture_capability_invalid'); return state
}
export const fixtureScopeState = (scope: FixtureScope) => Object.freeze({ ...getState(scope) })
export function fixtureMembershipRoute(userId: string) {
  return `/rest/v1/project_members?project_id=eq.${COPILOT_FIXTURE.id}&user_id=eq.${userId}&role=eq.OWNER&select=project_id,role,project:projects(id,name,key,mcp_enabled,archived)&limit=2`
}
export function fixtureRequestAllowed(scope: FixtureScope, userId: string, route: string, method: Parameters<Api>[1] = 'GET', body?: unknown) {
  const state = getState(scope), id = COPILOT_FIXTURE.id
  if (method === 'GET') {
    if ([`/rest/v1/profiles?id=eq.${userId}&select=id&limit=2`, fixtureMembershipRoute(userId),
      `/rest/v1/project_members?project_id=eq.${id}&user_id=eq.${userId}&select=user_id,role&limit=2`,
      `/rest/v1/projects?id=eq.${id}&select=id,name,key,mcp_enabled,archived&limit=2`, unrevokedRoute].includes(route)) return true
    for (const table of ['issues', 'ai_findings'] as const) for (let offset = 0; offset <= 2000; offset += 100) if (route === inventoryRoute(table, offset)) return true
    const filters = [state.connectionId ? `id=eq.${state.connectionId}` : null,
      state.label ? `client_label=eq.${encodeURIComponent(state.label)}&user_id=eq.${userId}` : null].filter(Boolean)
    return filters.some(filter => route === `/rest/v1/mcp_connections?project_id=eq.${id}&${filter}&select=id,project_id,user_id,client_label,revoked_at&limit=2`)
  }
  if (!state.active) return false
  if (method === 'PATCH' && route === `/rest/v1/projects?id=eq.${id}&select=id,mcp_enabled`) {
    if (JSON.stringify(body) === '{"mcp_enabled":false}') return state.enabled || state.recovery
    if (JSON.stringify(body) === '{"mcp_enabled":true}' && !state.recovery && !state.enabled && !state.issued) { state.enabled = true; return true }
    return false
  }
  if (method === 'POST' && route === '/rest/v1/rpc/issue_mcp_connection_token' && !state.recovery && !state.issued) {
    const value = body as { p_project_id?: string; p_user_id?: string; p_client_label?: string }
    if (value && Object.keys(value).length === 3 && value.p_project_id === id && value.p_user_id === userId
      && typeof value.p_client_label === 'string' && /^TrackQA Connect [0-9a-f-]{36}$/.test(value.p_client_label)) {
      state.issued = true; state.label = value.p_client_label; return true
    }
  }
  return method === 'POST' && route === '/rest/v1/rpc/revoke_mcp_connection' && !!state.connectionId
    && JSON.stringify(body) === JSON.stringify({ p_connection_id: state.connectionId })
}
export function observeFixtureResponse(scope: FixtureScope, userId: string, route: string, value: unknown) {
  const state = getState(scope)
  if (!state.issued || !Array.isArray(value) || value.length !== 1) return
  if (route === '/rest/v1/rpc/issue_mcp_connection_token' && UUID.test(value[0]?.connection_id)) state.connectionId = value[0].connection_id
  else if (route.startsWith('/rest/v1/mcp_connections?') && value[0]?.project_id === COPILOT_FIXTURE.id
    && value[0]?.user_id === userId && value[0]?.client_label === state.label && UUID.test(value[0]?.id)) state.connectionId = value[0].id
}
// Only the acceptance orchestrator calls this after two fresh preflights and
// explicit consent. Weak identity binds it to one Owner, adapter and Store.
export function grantFixturePermit(scope: FixtureScope, owner: Owner, adapter: Adapter, store: Store): FixturePermit {
  const state = getState(scope)
  requireValue(!state.active && !state.recovery && !state.granted && adapterClient(adapter) === 'vscode-copilot', 'fixture_capability_invalid')
  state.granted = true
  const permit = Object.freeze({}) as FixturePermit
  permits.set(permit, { scope, owner, adapter, store, used: false, expires: Date.now() + 60_000 }); return permit
}
export function consumeFixturePermit(permit: FixturePermit, owner: Owner, adapter: Adapter, store: Store) {
  const entry = permits.get(permit)
  requireValue(entry && !entry.used && entry.expires >= Date.now() && entry.owner === owner && entry.adapter === adapter && entry.store === store
    && !getState(entry.scope).active && adapterClient(adapter) === 'vscode-copilot' && adapterHome(adapter), 'fixture_capability_invalid')
  entry.used = true; getState(entry.scope).active = true
}
export function requireFixtureActive(scope: FixtureScope, projectId: string) {
  const state = getState(scope)
  requireValue(state.active && !state.recovery && projectId === COPILOT_FIXTURE.id, 'fixture_capability_invalid')
}
export function enableFixtureRecovery(scope: FixtureScope, record?: { clientLabel: string; connectionId: string | null }) {
  const state = getState(scope)
  state.active = true; state.recovery = true; state.enabled = true
  if (record) { state.issued = true; state.label = record.clientLabel; state.connectionId = record.connectionId ?? undefined }
}
