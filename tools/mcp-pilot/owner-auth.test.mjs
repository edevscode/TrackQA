import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { AUTH_URL, FIXTURE_PROJECT_ID, AUTH_CODES, authenticationFailure, withOwnerAuthentication } from './owner-auth.mjs'
import { createHumanApi, createStore } from './pilot.mjs'

const USER = '11111111-1111-4111-8111-111111111111'
const jwt = body => Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  + '.' + Buffer.from(JSON.stringify(body)).toString('base64url') + '.c3ludGhldGlj'
const KEY = jwt({ role: 'anon' })
const ACCESS = jwt({ sub: USER, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })
const REFRESH = 'synthetic-refresh-never-real'
const EMAIL = 'synthetic-owner@example.invalid'
const PASSWORD = 'synthetic-test-password-never-real'

function fixture(options = {}) {
  const calls = []
  let actionCalls = 0
  const user = { id: USER, aud: 'authenticated', role: 'authenticated', email: EMAIL,
    factors: options.mfa ? [{ status: 'verified' }] : [] }
  const fetch = async (input, init = {}) => {
    const url = new URL(input)
    calls.push({ path: url.pathname, method: init.method ?? 'GET', query: url.search })
    assert.equal(url.origin, AUTH_URL)
    assert.equal(init.redirect, 'error')
    if (url.pathname === '/auth/v1/token') {
      assert.equal(url.search, '?grant_type=password')
      assert.deepEqual(JSON.parse(init.body).email, EMAIL)
      assert.deepEqual(JSON.parse(init.body).password, PASSWORD)
      if (options.loginError) return Response.json({ [options.legacyCode ? 'error_code' : 'code']: options.loginError, msg: PASSWORD + ACCESS }, {
        status: options.status ?? 400, headers: options.legacyCode ? {} : { 'x-supabase-api-version': '2024-01-01' },
      })
      return Response.json({ access_token: ACCESS, refresh_token: REFRESH, token_type: 'bearer',
        expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user })
    }
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer ' + ACCESS)
    if (url.pathname === '/auth/v1/user') return Response.json(options.wrongIdentity ? { ...user, id: FIXTURE_PROJECT_ID } : user)
    if (url.pathname === '/auth/v1/logout') {
      assert.equal(url.search, '?scope=local')
      return options.logoutFailure ? Response.json({ code: 'unexpected_failure', msg: REFRESH }, { status: 500 }) : new Response(null, { status: 204 })
    }
    assert.equal(init.method, 'GET') // Auth verification must not mutate business data.
    if (url.pathname === '/rest/v1/profiles') return Response.json(options.noProfile ? [] : [{ id: USER }])
    if (url.pathname === '/rest/v1/project_members') {
      assert.equal(url.searchParams.get('project_id'), 'eq.' + FIXTURE_PROJECT_ID)
      assert.equal(url.searchParams.get('user_id'), 'eq.' + USER)
      return Response.json(options.noOwner ? [] : [{ user_id: USER, role: options.role ?? 'OWNER' }])
    }
    if (url.pathname === '/rest/v1/projects') return Response.json([{ id: FIXTURE_PROJECT_ID,
      name: options.wrongProject ? 'Other project' : 'MCP Synthetic Pilot', key: 'MCPPILOT', mcp_enabled: false }])
    throw new Error('Unexpected request')
  }
  const credentials = { supabaseUrl: AUTH_URL, projectId: FIXTURE_PROJECT_ID, publicApiKey: KEY,
    authProvider: 'password', email: EMAIL, password: PASSWORD, fetch, makeApi: values => createHumanApi({ ...values, fetch }) }
  return { calls, credentials, get actionCalls() { return actionCalls },
    run: action => withOwnerAuthentication(credentials, async api => { actionCalls++; return action?.(api) }) }
}

function assertNoSecrets(result) {
  const text = JSON.stringify(result)
  for (const value of [ACCESS, REFRESH, EMAIL, PASSWORD, KEY]) assert.equal(text.includes(value), false)
}

test('fresh supported sign-in verifies identity, profile, fixture OWNER and signs out only its session', async () => {
  const f = fixture()
  const result = await f.run()
  assert.deepEqual(result.authentication, { ok: true, code: 'ok', projectId: FIXTURE_PROJECT_ID,
    ownerVerified: true, profileVerified: true, sessionSignedOut: true })
  assert.equal(result.operation, undefined)
  assert.equal(f.actionCalls, 1)
  assert.equal(f.credentials.email, null)
  assert.equal(f.credentials.password, null)
  assert.equal(f.calls.filter(c => c.path === '/auth/v1/token').length, 1)
  assert.equal(f.calls.filter(c => c.path === '/auth/v1/logout').length, 1)
  assert.equal(f.calls.filter(c => c.path.startsWith('/rest/') && c.method !== 'GET').length, 0)
  assertNoSecrets(result)
})

for (const [option, expected] of [
  [{ loginError: 'invalid_credentials' }, 'invalid_credentials'],
  [{ loginError: 'invalid_credentials', legacyCode: true }, 'invalid_credentials'],
  [{ loginError: 'email_not_confirmed' }, 'email_not_confirmed'],
  [{ loginError: 'captcha_failed' }, 'captcha_required'],
  [{ loginError: 'over_request_rate_limit', status: 429 }, 'rate_limited'],
  [{ loginError: 'secret-' + PASSWORD }, 'authentication_failed'],
  [{ noProfile: true }, 'profile_required'],
  [{ noOwner: true }, 'owner_membership_required'],
  [{ role: 'QA' }, 'owner_membership_required'],
  [{ wrongProject: true }, 'project_mismatch'],
  [{ wrongIdentity: true }, 'identity_unverified'],
  [{ mfa: true }, 'mfa_required'],
]) test('failure is sanitized and no action runs: ' + expected, async () => {
  const f = fixture(option)
  await assert.rejects(f.run(), error => {
    const result = authenticationFailure(error)
    assert.equal(result.ok, false)
    assert.equal(result.code, expected)
    assert.equal(result.sessionSignedOut, option.loginError ? null : true)
    assertNoSecrets(result)
    assertNoSecrets({ message: error.message })
    return true
  })
  assert.equal(f.actionCalls, 0)
  assert.ok(f.calls.filter(c => c.path === '/auth/v1/token').length <= 1)
})

test('current-session sign-out failure is visible and never retried', async () => {
  const f = fixture({ logoutFailure: true })
  await assert.rejects(f.run(), e => {
    const result = authenticationFailure(e)
    assert.equal(result.code, 'session_signout_failed')
    assert.equal(result.sessionSignedOut, false)
    assertNoSecrets(result)
    return true
  })
  assert.equal(f.calls.filter(c => c.path === '/auth/v1/logout').length, 1)
})

test('existing operation callback result and error semantics are preserved', async () => {
  const f = fixture()
  assert.deepEqual((await f.run(() => ({ connectionId: USER, disabled: true }))).operation, { connectionId: USER, disabled: true })
  const other = fixture()
  const error = new Error('Pilot operation failed.')
  await assert.rejects(other.run(() => { throw error }), e => e === error)
  assert.equal(other.calls.filter(c => c.path === '/auth/v1/logout').length, 1)
})

test('wrong target, backend key and cancelled checks are denied before sign-in', async () => {
  for (const extra of [{ supabaseUrl: 'https://other.invalid' }, { projectId: USER }, { publicApiKey: jwt({ role: 'service_role' }) }, { interrupted: () => true }]) {
    const f = fixture()
    await assert.rejects(withOwnerAuthentication({ ...f.credentials, ...extra }))
    assert.equal(f.calls.length, 0)
  }
})

test('worker Auth mode returns only allow-listed metadata and leaves recovery/config unchanged', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'trackqa-auth-test-'))
  const root = path.join(base, 'TrackQA-MCP-Pilot')
  await fs.mkdir(path.join(root, '.agents'), { recursive: true })
  const store = createStore(root)
  await store.prepare()
  const state = await fs.readFile(path.join(root, 'pilot-state.json'), 'utf8')
  const config = await fs.readFile(path.join(root, '.agents/mcp_config.json'), 'utf8')
  t.after(async () => {
    assert.equal(path.dirname(base), os.tmpdir()); assert.ok(path.basename(base).startsWith('trackqa-auth-test-'))
    for (const name of ['pilot-state.json', '.agents/mcp_config.json', '.gitignore']) await fs.unlink(path.join(root, name))
    await fs.rmdir(path.join(root, '.agents')); await fs.rmdir(root); await fs.rmdir(base)
  })
  const result = spawnSync(process.execPath, [path.resolve('tools/mcp-pilot/pilot.mjs')], {
    encoding: 'utf8', env: { SystemRoot: process.env.SystemRoot, LOCALAPPDATA: base },
    input: JSON.stringify({ mode: 'Auth', supabaseUrl: 'https://other.invalid', projectId: FIXTURE_PROJECT_ID,
      publicApiKey: KEY, email: EMAIL, password: PASSWORD }),
  })
  assert.equal(result.status, 1)
  const safe = JSON.parse(result.stdout)
  assert.equal(safe.code, 'configuration')
  assert.ok(AUTH_CODES.includes(safe.code))
  assertNoSecrets(safe)
  assertNoSecrets({ stderr: result.stderr })
  assert.equal(await fs.readFile(path.join(root, 'pilot-state.json'), 'utf8'), state)
  assert.equal(await fs.readFile(path.join(root, '.agents/mcp_config.json'), 'utf8'), config)
})
