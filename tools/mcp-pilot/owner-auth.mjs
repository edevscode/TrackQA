import { createClient } from '@supabase/supabase-js'
import { GOOGLE_CODES, GooglePkceError, googlePkceSignIn } from './google-pkce.mjs'

export const AUTH_URL = 'https://mzeuimqfrswrwoaqjdmp.supabase.co'
export const FIXTURE_PROJECT_ID = '5a759e3f-50b4-4fdd-b8ad-43469a7100c0'
export const AUTH_CODES = Object.freeze(['ok', 'configuration', 'invalid_credentials',
  'email_not_confirmed', 'captcha_required', 'rate_limited', 'mfa_required',
  'identity_unverified', 'profile_required', 'owner_membership_required',
  'project_mismatch', 'verification_failed', 'authentication_failed',
  'transport', 'response_limit', 'session_signout_failed', 'interrupted', ...GOOGLE_CODES])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class OwnerAuthError extends Error {
  constructor(code) {
    super('Owner authentication did not complete.')
    this.code = AUTH_CODES.includes(code) && code !== 'ok' ? code : 'authentication_failed'
    this.sessionSignedOut = null
  }
}

export function authenticationFailure(error) {
  return { ok: false, code: error instanceof OwnerAuthError ? error.code : 'authentication_failed',
    projectId: FIXTURE_PROJECT_ID, ownerVerified: false, profileVerified: false,
    sessionSignedOut: error instanceof OwnerAuthError ? error.sessionSignedOut : null }
}

function requireValue(value, code) { if (!value) throw new OwnerAuthError(code) }
function loginCode(error) {
  if (error?.code === 'invalid_credentials' || error?.code === 'email_not_confirmed') return error.code
  if (error?.code === 'captcha_failed') return 'captcha_required'
  if (error?.status === 429 || error?.code === 'over_request_rate_limit') return 'rate_limited'
  if (error?.name === 'AuthRetryableFetchError') return 'transport'
  return 'authentication_failed'
}

// SDK Auth transport only: one password/PKCE exchange, user verification and
// local-session sign-out. No refresh, database mutations or HTTP redirects.
// Credential/session response bodies never enter diagnostics.
function authTransport(send, timeoutMs, provider) {
  const posts = new Set()
  return async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    const method = (init.method ?? 'GET').toUpperCase()
    requireValue(url.origin === AUTH_URL && !url.username && !url.password, 'configuration')
    const login = url.pathname === '/auth/v1/token' && url.search === (provider === 'google' ? '?grant_type=pkce' : '?grant_type=password')
    const logout = url.pathname === '/auth/v1/logout' && url.search === '?scope=local'
    requireValue(method === 'POST' ? login || logout : method === 'GET' && url.pathname === '/auth/v1/user', 'configuration')
    if (method === 'POST') {
      requireValue(!posts.has(url.pathname), 'authentication_failed')
      posts.add(url.pathname) // One attempt; never retry login/logout automatically.
    }
    const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
    let response
    try { response = await send(url.href, { ...init, signal, redirect: 'error', cache: 'no-store', credentials: 'omit' }) }
    catch { throw new OwnerAuthError('transport') }
    requireValue(!response.redirected, 'transport')
    if (!response.body) return response
    const reader = response.body.getReader()
    const chunks = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        requireValue(size <= 65_536, 'response_limit')
        chunks.push(value)
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers })
  }
}

// Only the verified API closure reaches existing Issue/Cleanup callbacks. No
// caller receives the SDK client, access token, refresh token or login response.
export async function withOwnerAuthentication(options, action = async () => undefined) {
  const { publicApiKey, projectId, makeApi, interrupted = () => false, timeoutMs = 5000 } = options
  const provider = options.authProvider ?? 'google'
  let apiClaims = {}
  try { apiClaims = JSON.parse(Buffer.from(publicApiKey.split('.')[1], 'base64url').toString('utf8')) } catch { /* Public publishable keys are also supported. */ }
  requireValue(options.supabaseUrl === AUTH_URL && projectId === FIXTURE_PROJECT_ID
    && typeof makeApi === 'function' && Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 5000
    && typeof publicApiKey === 'string' && publicApiKey.length <= 8192
    && ['google', 'password'].includes(provider)
    && (publicApiKey.startsWith('sb_publishable_') || apiClaims.role === 'anon'), 'configuration')
  if (provider === 'password') requireValue(typeof options.email === 'string' && options.email.length <= 320 && options.email.trim()
    && typeof options.password === 'string' && options.password.length > 0 && options.password.length <= 8192, 'configuration')
  const client = createClient(AUTH_URL, publicApiKey, {
    auth: { flowType: 'pkce', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, debug: false },
    db: { retry: false }, global: { fetch: authTransport(options.fetch ?? globalThis.fetch, timeoutMs, provider) },
  })
  let sessionCreated = false
  let signedOut = null
  let failure
  let operation
  let operationStarted = false
  try {
    requireValue(!interrupted(), 'interrupted')
    const login = provider === 'google' ? await googlePkceSignIn(client, options)
      : await client.auth.signInWithPassword({ email: options.email.trim(), password: options.password })
    options.email = null; options.password = null
    sessionCreated = Boolean(login.data?.session)
    if (login.error) throw new OwnerAuthError(loginCode(login.error))
    requireValue(sessionCreated, 'identity_unverified')
    const verified = await client.auth.getUser()
    requireValue(!verified.error && UUID.test(verified.data?.user?.id)
      && verified.data.user.id === login.data.user?.id, 'identity_unverified')
    const user = verified.data.user
    requireValue(!user.factors?.some(f => f.status === 'verified'), 'mfa_required')
    const api = makeApi({ ownerAccessToken: login.data.session.access_token, publicApiKey })
    const profile = await api(`/rest/v1/profiles?id=eq.${user.id}&select=id&limit=2`)
    requireValue(Array.isArray(profile) && profile.length === 1 && profile[0].id === user.id, 'profile_required')
    const members = await api(`/rest/v1/project_members?project_id=eq.${projectId}&user_id=eq.${user.id}&select=user_id,role&limit=2`)
    requireValue(Array.isArray(members) && members.length === 1 && members[0].user_id === user.id && members[0].role === 'OWNER', 'owner_membership_required')
    const projects = await api(`/rest/v1/projects?id=eq.${projectId}&select=id,name,key&limit=2`)
    requireValue(Array.isArray(projects) && projects.length === 1 && projects[0].id === projectId
      && projects[0].name === 'MCP Synthetic Pilot' && projects[0].key === 'MCPPILOT', 'project_mismatch')
    requireValue(!interrupted(), 'interrupted')
    operationStarted = true
    operation = await action(api)
  } catch (error) {
    failure = error instanceof GooglePkceError ? new OwnerAuthError(error.code)
      : error instanceof OwnerAuthError || operationStarted ? error : new OwnerAuthError('verification_failed')
  } finally {
    options.email = null; options.password = null
    if (sessionCreated) {
      try { signedOut = !(await client.auth.signOut({ scope: 'local' })).error } catch { signedOut = false }
      if (!signedOut) failure = new OwnerAuthError('session_signout_failed')
    }
  }
  if (failure) {
    if (failure instanceof OwnerAuthError) failure.sessionSignedOut = signedOut
    throw failure
  }
  return { authentication: { ok: true, code: 'ok', projectId, ownerVerified: true,
    profileVerified: true, sessionSignedOut: signedOut }, operation }
}
