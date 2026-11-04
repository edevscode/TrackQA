import { createClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { googlePkceSignIn, GooglePkceError } from '../../mcp-pilot/google-pkce.mjs'
import { boundedJson, ConnectorError, requireValue, SUPABASE_URL, UUID } from './core.ts'
import type { Api, Project } from './core.ts'
import { fixtureMembershipRoute, fixtureRequestAllowed, fixtureScopeState, observeFixtureResponse } from './testing/copilot-fixture-scope.ts'
import type { FixtureScope } from './testing/copilot-fixture-scope.ts'

export function isPublicKey(key: string) {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true
  try { return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon' } catch { return false }
}
export async function publicKey(env: NodeJS.ProcessEnv = process.env) {
  let value = env.TRACKQA_PUBLIC_KEY ?? env.VITE_SUPABASE_ANON_KEY
  // Local development only: read the existing app's public key, never load its
  // other variables into process.env or pass them to the coding client.
  if (!value) {
    for (const file of ['.env.local', '.env']) {
      try {
        const text = await readFile(new URL('../../../' + file, import.meta.url), 'utf8')
        const line = text.split(/\r?\n/).find(line => /^\s*VITE_SUPABASE_ANON_KEY\s*=/.test(line))
        if (line) value = parseEnv(line).VITE_SUPABASE_ANON_KEY
        if (value) break
      } catch { /* No secret or filesystem error details leave this function. */ }
    }
  }
  requireValue(value && value.length <= 8192 && isPublicKey(value), 'public_key_required')
  return value
}
type AuthOptions = {
  key: string; signal?: AbortSignal; fetch?: typeof fetch
  signIn?: typeof googlePkceSignIn; makeClient?: typeof createClient
  fixtureScope?: FixtureScope
}
export type Owner = { userId: string; api: Api; projects: Project[] }

// The CLI receives only a checked human API closure. Raw Auth tokens and the SDK
// client never reach the client adapter or the recovery store.
export async function withOwner<T>(options: AuthOptions, action: (owner: Owner) => Promise<T>): Promise<T> {
  requireValue(isPublicKey(options.key), 'public_key_required')
  if (options.fixtureScope) fixtureScopeState(options.fixtureScope)
  const posts = new Set<string>()
  const send = options.fetch ?? fetch
  const authFetch: typeof fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const method = init.method ?? 'GET'
    const allowed = method === 'GET' ? url.pathname === '/auth/v1/user' && !url.search
      : method === 'POST' && ((url.pathname === '/auth/v1/token' && url.search === '?grant_type=pkce')
        || (url.pathname === '/auth/v1/logout' && url.search === '?scope=local'))
    requireValue(url.origin === SUPABASE_URL && allowed, 'authentication_failed')
    if (method === 'POST') { requireValue(!posts.has(url.pathname), 'authentication_failed'); posts.add(url.pathname) }
    let response: Response
    try { response = await send(url.href, { ...init, signal: AbortSignal.timeout(10_000), redirect: 'error', credentials: 'omit', cache: 'no-store' }) }
    catch { throw new ConnectorError('authentication_failed') }
    // Bound error responses too; only the SDK sees their bodies, never output.
    if (response.status === 204) return new Response(null, { status: 204 })
    try {
      const data = await boundedJson(new Response(response.body, { status: 200 }), 65_536)
      return Response.json(data, { status: response.status, headers: response.headers })
    } catch {
      throw new ConnectorError('authentication_failed')
    } finally { await response.body?.cancel().catch(() => {}) }
  }
  const memory = new Map<string, string>()
  const client = (options.makeClient ?? createClient)(SUPABASE_URL, options.key, {
    auth: { flowType: 'pkce', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, debug: false,
      storage: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value) }, removeItem: (key: string) => { memory.delete(key) } } },
    db: { retry: false }, global: { fetch: authFetch },
  })
  let login: Awaited<ReturnType<typeof client.auth.signInWithPassword>> | undefined
  let authenticated = false
  let result: T | undefined
  let failure: unknown
  let access = ''
  try {
    requireValue(!options.signal?.aborted, 'interrupted')
    login = await (options.signIn ?? googlePkceSignIn)(client, { signal: options.signal })
    authenticated = Boolean(login?.data?.session)
    requireValue(authenticated && !login?.error, 'authentication_failed')
    const verified = await client.auth.getUser()
    const user = verified.data?.user
    requireValue(!verified.error && user && UUID.test(user.id) && user.id === login?.data?.user?.id, 'identity_unverified')
    requireValue(!user.factors?.some(factor => factor.status === 'verified'), 'mfa_unsupported')
    access = login!.data.session!.access_token
    const api: Api = async (route, method = 'GET', body) => {
      // Fixed project endpoint; no arbitrary targets, redirects or privileged key.
      const url = new URL(route, SUPABASE_URL)
      requireValue(url.origin === SUPABASE_URL && !url.username && !url.password && route.startsWith('/rest/v1/'), 'request_failed')
      const resource = url.pathname.slice('/rest/v1/'.length)
      requireValue(options.fixtureScope ? fixtureRequestAllowed(options.fixtureScope, user.id, route, method, body) : method === 'GET' ? ['profiles', 'projects', 'project_members', 'mcp_connections'].includes(resource)
        : method === 'PATCH' ? resource === 'projects' && !!url.searchParams.get('id') && JSON.stringify(body) === '{"mcp_enabled":true}'
          : ['rpc/issue_mcp_connection_token', 'rpc/revoke_mcp_connection'].includes(resource), 'request_failed')
      try {
        const result = await boundedJson(await send(url.href, { method, headers: { apikey: options.key, Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000), redirect: 'error', cache: 'no-store', credentials: 'omit' }))
        if (options.fixtureScope) observeFixtureResponse(options.fixtureScope, user.id, route, result)
        return result
      } catch { throw new ConnectorError('request_failed') }
    }
    const profile = await api(`/rest/v1/profiles?id=eq.${user.id}&select=id&limit=2`)
    requireValue(Array.isArray(profile) && profile.length === 1 && profile[0].id === user.id, 'profile_required')
    const memberships = await api(options.fixtureScope ? fixtureMembershipRoute(user.id) : `/rest/v1/project_members?user_id=eq.${user.id}&role=eq.OWNER&select=project_id,role,project:projects(id,name,key,mcp_enabled,archived)&limit=201`)
    requireValue(Array.isArray(memberships) && memberships.length <= 200, 'project_selection_unavailable')
    const projects = memberships.filter(row => row.role === 'OWNER' && UUID.test(row.project_id) && row.project?.id === row.project_id
      && row.project.archived === false && typeof row.project.mcp_enabled === 'boolean' && typeof row.project.name === 'string' && typeof row.project.key === 'string')
      .map(row => row.project as Project)
    requireValue(!options.signal?.aborted, 'interrupted')
    result = await action({ userId: user.id, api, projects })
  } catch (error) {
    failure = error instanceof ConnectorError ? error : error instanceof GooglePkceError ? new ConnectorError(error.code) : new ConnectorError('authentication_failed')
  } finally {
    access = ''
    if (authenticated) {
      try { if ((await client.auth.signOut({ scope: 'local' })).error) failure ??= new ConnectorError('signout_unconfirmed') }
      catch { failure ??= new ConnectorError('signout_unconfirmed') }
    }
    if (login?.data.session) { login.data.session.access_token = ''; login.data.session.refresh_token = ''; login.data.session.provider_token = null; login.data.session.provider_refresh_token = null }
    login = undefined
    memory.clear() // Includes any verifier retained after an incomplete exchange.
  }
  if (failure) throw failure
  return result as T
}
