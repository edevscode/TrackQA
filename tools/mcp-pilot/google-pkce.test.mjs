import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { createGoogleCallback, GOOGLE_REDIRECT, GooglePkceError, openSystemBrowser } from './google-pkce.mjs'
import { AUTH_URL, FIXTURE_PROJECT_ID, withOwnerAuthentication, authenticationFailure } from './owner-auth.mjs'
import { createHumanApi } from './pilot.mjs'

const CODE = 'synthetic-code-never-issued'
const USER = '11111111-1111-4111-8111-111111111111'
const jwt = body => Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  + '.' + Buffer.from(JSON.stringify(body)).toString('base64url') + '.c3ludGhldGlj'
const KEY = jwt({ role: 'anon' })
const ACCESS = jwt({ sub: USER, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })
const REFRESH = 'synthetic-refresh-never-real'
const PROVIDER_TOKEN = 'synthetic-google-token-never-real'

function sockets(options = {}) {
  const servers = []
  const serverFactory = (_options, handler) => {
    const server = new EventEmitter()
    server.handler = handler
    server.listening = false
    server.closeCalls = 0
    server.listen = (settings, callback) => {
      server.settings = settings
      queueMicrotask(() => {
        if (options.busyHost === settings.host) server.emit('error', { code: 'EADDRINUSE' })
        else if (options.failHost === settings.host) server.emit('error', { code: 'EACCES' })
        else { server.listening = true; callback() }
      })
    }
    server.close = callback => { server.listening = false; server.closeCalls++; queueMicrotask(callback) }
    server.closeAllConnections = () => {}
    server.closeIdleConnections = () => {}
    servers.push(server)
    return server
  }
  const request = (url, options = {}) => {
    const response = { status: null, headers: {}, body: '',
      writeHead(status, headers) { this.status = status; this.headers = headers },
      end(body) { this.body = body },
    }
    servers[0].handler({ url, method: options.method ?? 'GET',
      headers: { host: 'localhost:5173', ...(options.cookie ? { cookie: options.cookie } : {}), ...options.headers },
      socket: { remoteAddress: options.remote ?? '127.0.0.1' },
    }, response)
    return response
  }
  return { servers, serverFactory, request }
}

function fixture(options = {}) {
  const transport = sockets(options)
  const calls = []
  let browserCalls = 0
  let actions = 0
  let challenge
  let callbackCookie
  let callbackResponse
  const user = { id: USER, aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.invalid', factors: [] }
  const fetch = async (input, init = {}) => {
    const url = new URL(input)
    calls.push({ path: url.pathname, method: init.method ?? 'GET', query: url.search })
    assert.equal(url.origin, AUTH_URL)
    assert.equal(init.redirect, 'error')
    if (url.pathname === '/auth/v1/token') {
      assert.equal(url.search, '?grant_type=pkce')
      assert.equal(transport.servers.every(s => !s.listening), true, 'callback sockets must close before exchange')
      const body = JSON.parse(init.body)
      assert.equal(body.auth_code, CODE)
      assert.ok(typeof body.code_verifier === 'string' && body.code_verifier.length >= 43)
      assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'), challenge)
      if (options.exchangeFailure) return Response.json({ error_code: 'bad_code_verifier', msg: REFRESH }, { status: 400 })
      return Response.json({ access_token: ACCESS, refresh_token: REFRESH, provider_token: PROVIDER_TOKEN,
        token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user })
    }
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer ' + ACCESS)
    if (url.pathname === '/auth/v1/user') return Response.json(user)
    if (url.pathname === '/auth/v1/logout') { assert.equal(url.search, '?scope=local'); return new Response(null, { status: 204 }) }
    assert.equal(init.method, 'GET')
    if (url.pathname === '/rest/v1/profiles') return Response.json(options.noProfile ? [] : [{ id: USER }])
    if (url.pathname === '/rest/v1/project_members') return Response.json(options.noOwner ? [] : [{ user_id: USER, role: 'OWNER' }])
    if (url.pathname === '/rest/v1/projects') return Response.json([{ id: FIXTURE_PROJECT_ID, name: 'MCP Synthetic Pilot', key: 'MCPPILOT' }])
    throw Error('Unexpected request')
  }
  const openBrowser = async url => {
    browserCalls++
    assert.equal(transport.servers.length, 2)
    assert.equal(transport.servers.every(s => s.listening), true, 'both loopback sockets must bind first')
    if (options.browserFailure) throw new Error(REFRESH)
    if (options.browserStall) return new Promise(() => {})
    const u = new URL(url)
    assert.equal(u.origin, 'http://localhost:5173')
    const start = transport.request(u.pathname + u.search)
    assert.equal(start.status, 302)
    assert.equal(start.headers['Referrer-Policy'], 'no-referrer')
    callbackCookie = start.headers['Set-Cookie'].split(';')[0]
    assert.match(start.headers['Set-Cookie'], /HttpOnly; SameSite=Lax$/)
    assert.equal(start.headers['Set-Cookie'].includes('Expires='), false)
    const authorize = new URL(start.headers.Location)
    assert.equal(authorize.origin, AUTH_URL)
    assert.equal(authorize.pathname, '/auth/v1/authorize')
    assert.equal(authorize.searchParams.get('provider'), 'google')
    assert.equal(authorize.searchParams.get('redirect_to'), GOOGLE_REDIRECT)
    assert.equal(authorize.searchParams.get('code_challenge_method'), 's256')
    challenge = authorize.searchParams.get('code_challenge')
    if (options.abort) { options.abort.abort(); return }
    if (options.noCallback) return
    const query = options.oauthDenied ? '?error=access_denied&error_description=' + REFRESH
      : '?code=' + CODE + (options.wrongFlow ? '&sb_flow_id=wrongflow0000' : '')
    callbackResponse = transport.request('/mcp-pilot/callback' + query, { cookie: options.missingCookie ? undefined : callbackCookie })
    if (!options.oauthDenied && !options.wrongFlow && !options.missingCookie) assert.equal(callbackResponse.status, 200)
  }
  const args = { supabaseUrl: AUTH_URL, projectId: FIXTURE_PROJECT_ID, publicApiKey: KEY,
    authProvider: 'google', fetch, openBrowser, serverFactory: transport.serverFactory,
    oauthTimeoutMs: options.shortTimeout ? 25 : 1000, signal: options.abort?.signal,
    makeApi: values => createHumanApi({ ...values, fetch }),
  }
  return { ...transport, calls, args, get browserCalls() { return browserCalls },
    get actions() { return actions }, get callbackResponse() { return callbackResponse },
    replay() { return transport.request('/mcp-pilot/callback?code=' + CODE, { cookie: callbackCookie }) },
    run: () => withOwnerAuthentication(args, async () => { actions++; return { disabled: true } }),
  }
}

function noSecrets(value) {
  const text = JSON.stringify(value)
  for (const secret of [CODE, ACCESS, REFRESH, PROVIDER_TOKEN, KEY]) assert.equal(text.includes(secret), false)
}

test('Google PKCE uses real SDK, exact redirect, memory verifier and nonce correlation; verifies OWNER then signs out', async () => {
  const f = fixture()
  const result = await f.run()
  assert.equal(result.authentication.ok, true)
  assert.equal(result.authentication.ownerVerified, true)
  assert.equal(result.authentication.sessionSignedOut, true)
  assert.deepEqual(result.operation, { disabled: true })
  assert.equal(f.browserCalls, 1)
  assert.equal(f.actions, 1)
  assert.equal(f.calls.filter(c => c.path === '/auth/v1/token').length, 1)
  assert.equal(f.calls.filter(c => c.path.startsWith('/rest/') && c.method !== 'GET').length, 0)
  assert.deepEqual(f.servers.map(s => s.settings.host), ['127.0.0.1', '::1'])
  assert.equal(f.servers.every(s => s.settings.port === 5173 && !s.listening && s.closeCalls === 1), true)
  assert.equal(f.replay().status, 410)
  noSecrets(result)
  noSecrets({ body: f.callbackResponse.body, headers: f.callbackResponse.headers })
})

for (const [options, code] of [
  [{ busyHost: '127.0.0.1' }, 'callback_port_in_use'],
  [{ busyHost: '::1' }, 'callback_port_in_use'],
  [{ failHost: '::1' }, 'callback_unavailable'],
  [{ browserFailure: true }, 'browser_open_failed'],
  [{ browserStall: true, shortTimeout: true }, 'callback_timeout'],
  [{ noCallback: true, shortTimeout: true }, 'callback_timeout'],
  [{ oauthDenied: true }, 'oauth_denied'],
  [{ wrongFlow: true }, 'callback_rejected'],
  [{ missingCookie: true }, 'callback_rejected'],
  [{ exchangeFailure: true }, 'authentication_failed'],
  [{ noProfile: true }, 'profile_required'],
  [{ noOwner: true }, 'owner_membership_required'],
]) test('Google failure closes listeners and returns only a sanitized code: ' + code, async () => {
  const f = fixture(options)
  await assert.rejects(f.run(), error => {
    const result = authenticationFailure(error)
    assert.equal(result.code, code)
    assert.equal(result.ok, false)
    noSecrets(result); noSecrets({ message: error.message })
    return true
  })
  assert.equal(f.actions, 0)
  assert.equal(f.servers.every(s => !s.listening), true)
  assert.ok(f.calls.filter(c => c.path === '/auth/v1/token').length <= 1)
  if (options.busyHost || options.failHost) { assert.equal(f.browserCalls, 0); assert.equal(f.calls.length, 0) }
  if (options.noProfile || options.noOwner) assert.equal(f.calls.filter(c => c.path === '/auth/v1/logout').length, 1)
})

test('cancellation during browser authorization closes all listeners without exchanging a code', async () => {
  const f = fixture({ abort: new AbortController() })
  await assert.rejects(f.run(), e => authenticationFailure(e).code === 'interrupted')
  assert.equal(f.servers.every(s => !s.listening), true)
  assert.equal(f.calls.length, 0)
})

async function callbackFixture(t) {
  const f = sockets()
  const callback = await createGoogleCallback({ serverFactory: f.serverFactory, timeoutMs: 1000 })
  t.after(() => callback.close())
  const authorize = AUTH_URL + '/auth/v1/authorize?provider=google&redirect_to=' + encodeURIComponent(GOOGLE_REDIRECT)
    + '&code_challenge_method=s256&code_challenge=' + 'a'.repeat(43)
  callback.configure(authorize, 'expectedflow1234')
  const u = new URL(callback.startUrl)
  const start = f.request(u.pathname + u.search)
  const cookie = start.headers['Set-Cookie'].split(';')[0]
  return { ...f, callback, cookie }
}

test('arbitrary hosts, origins, remote addresses, wrong paths and methods are rejected without reflecting data', async t => {
  const f = await callbackFixture(t)
  for (const [url, options, status] of [
    ['/mcp-pilot/callback?code=' + CODE, { headers: { host: 'evil.invalid:5173' } }, 403],
    ['/mcp-pilot/callback?code=' + CODE, { headers: { origin: 'https://evil.invalid' } }, 403],
    ['/mcp-pilot/callback?code=' + CODE, { remote: '192.0.2.1' }, 403],
    ['/wrong/../mcp-pilot/callback?code=' + CODE, {}, 404],
    ['/favicon.ico', {}, 404],
    ['/mcp-pilot/callback?code=' + CODE + '#fragment', {}, 400],
    ['/mcp-pilot/callback?code=' + CODE, { method: 'POST' }, 405],
  ]) {
    const response = f.request(url, { cookie: f.cookie, ...options })
    assert.equal(response.status, status)
    assert.equal(response.body.includes(CODE), false)
  }
  const ok = f.request('/mcp-pilot/callback?code=' + CODE, { cookie: f.cookie })
  assert.equal(ok.status, 200)
  assert.equal(await f.callback.code, CODE)
})

for (const query of [
  '?code=' + CODE + '&code=second', '?code=' + CODE + '&error=access_denied',
  '?code=' + CODE + '&state=untrusted', '?code=', '?access_token=' + ACCESS,
]) test('malformed callback cannot be used for code exchange', async t => {
  const f = await callbackFixture(t)
  assert.equal(f.request('/mcp-pilot/callback' + query, { cookie: f.cookie }).status, 400)
  await assert.rejects(f.callback.code, e => e instanceof GooglePkceError && e.code === 'callback_rejected')
})

test('a callback before browser bootstrap cannot complete the flow', async t => {
  const f = sockets()
  const callback = await createGoogleCallback({ serverFactory: f.serverFactory, timeoutMs: 1000 })
  t.after(() => callback.close())
  f.request('/mcp-pilot/callback?code=' + CODE)
  await assert.rejects(callback.code, e => e.code === 'callback_rejected')
})

test('system browser launcher refuses non-bootstrap URLs without starting a process', async () => {
  for (const url of ['https://evil.invalid', 'http://localhost:5173/mcp-pilot/start?nonce=bad']) {
    await assert.rejects(async () => openSystemBrowser(url), e => e.code === 'browser_open_failed')
  }
})
