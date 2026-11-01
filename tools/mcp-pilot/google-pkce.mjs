import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { execFile } from 'node:child_process'
import path from 'node:path'

export const GOOGLE_REDIRECT = 'http://localhost:5173/mcp-pilot/callback'
export const GOOGLE_CODES = Object.freeze(['callback_port_in_use', 'callback_unavailable',
  'callback_timeout', 'callback_rejected', 'oauth_denied', 'oauth_failed',
  'browser_open_failed', 'interrupted'])
const HOST = 'localhost:5173'
const CALLBACK = '/mcp-pilot/callback'
const COOKIE = 'trackqa_mcp_pilot_flow'
const START = '/mcp-pilot/start'

export class GooglePkceError extends Error {
  constructor(code) {
    super('Google authorization did not complete.')
    this.code = GOOGLE_CODES.includes(code) ? code : 'oauth_failed'
  }
}
const failure = code => new GooglePkceError(code)

// Only this local, one-time bootstrap URL reaches the default browser launcher.
// It contains no authorization code, access/refresh token or PKCE verifier.
export function openSystemBrowser(url) {
  const u = new URL(url)
  if (process.platform !== 'win32' || u.origin !== 'http://' + HOST || u.pathname !== START
    || !/^[0-9a-f]{64}$/.test(u.searchParams.get('nonce') ?? '')) throw failure('browser_open_failed')
  return new Promise((resolve, reject) => {
    execFile(path.join(process.env.SystemRoot ?? 'C:/Windows', 'System32/rundll32.exe'),
      ['url.dll,FileProtocolHandler', u.href], { windowsHide: true, timeout: 5000, maxBuffer: 1024 },
      error => error ? reject(failure('browser_open_failed')) : resolve())
  })
}

// No request logger. Two fixed loopback bindings prevent localhost resolving to
// a different application's IPv4/IPv6 listener. Never use 0.0.0.0 or :: here.
export async function createGoogleCallback({ timeoutMs = 300_000, signal, serverFactory = createServer } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw failure('callback_unavailable')
  const nonce = randomBytes(32).toString('hex')
  const servers = []
  let authorizationUrl
  let flowId
  let started = false
  let settled = false
  let closed = false
  let timer
  let resolveCode, rejectCode
  const code = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject })
  // A failure can occur while opening the browser, before the caller awaits it.
  void code.catch(() => {})
  function finish(error, value) {
    if (settled) return
    settled = true
    clearTimeout(timer)
    error ? rejectCode(error) : resolveCode(value)
  }
  const abort = () => finish(failure('interrupted'))
  async function close() {
    if (closed) return
    closed = true
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
    if (!settled) finish(failure('interrupted'))
    await Promise.all(servers.map(server => new Promise(resolve => {
      const force = setTimeout(() => server.closeAllConnections?.(), 250)
      try { server.close(() => { clearTimeout(force); resolve() }); server.closeIdleConnections?.() }
      catch { clearTimeout(force); resolve() }
    })))
    authorizationUrl = undefined; flowId = undefined
  }
  function respond(response, status, message, extra = {}) {
    response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store', 'Pragma': 'no-cache', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", Connection: 'close', ...extra })
    response.end(message)
  }
  const clearCookie = `${COOKIE}=; Path=${CALLBACK}; HttpOnly; SameSite=Lax; Max-Age=0`
  function handler(request, response) {
    try {
      const remote = request.socket.remoteAddress
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)
        || request.headers.host !== HOST || (request.headers.origin && request.headers.origin !== 'http://' + HOST)) {
        respond(response, 403, 'Request rejected.'); return
      }
      if (request.method !== 'GET') { respond(response, 405, 'Request rejected.'); return }
      const raw = request.url ?? ''
      if (!raw.startsWith('/') || raw.startsWith('//') || raw.length > 8192) { respond(response, 400, 'Request rejected.'); return }
      if (![START, CALLBACK].includes(raw.split('?')[0])) { respond(response, 404, 'Not found.'); return }
      const url = new URL(raw, 'http://' + HOST)
      if (url.hash) { respond(response, 400, 'Request rejected.'); return }
      if (url.pathname === START) {
        if (settled || started || !authorizationUrl || url.searchParams.getAll('nonce').length !== 1
          || url.searchParams.get('nonce') !== nonce || [...url.searchParams.keys()].some(k => k !== 'nonce')) {
          respond(response, 403, 'Request rejected.'); return
        }
        started = true
        // Session cookie: no OAuth credentials and no persistent expiry. It is
        // only a browser-to-attempt correlation value for this loopback origin.
        respond(response, 302, 'Continue authorization in the browser.', {
          Location: authorizationUrl,
          'Set-Cookie': `${COOKIE}=${nonce}; Path=${CALLBACK}; HttpOnly; SameSite=Lax`,
        })
        return
      }
      if (url.pathname !== CALLBACK) { respond(response, 404, 'Not found.'); return }
      if (settled) { respond(response, 410, 'Authorization response already handled.'); return }
      const cookies = String(request.headers.cookie ?? '').split(';').map(v => v.trim())
        .filter(v => v.startsWith(COOKIE + '=')).map(v => v.slice(COOKIE.length + 1))
      const matched = cookies.length === 1 && /^[0-9a-f]{64}$/.test(cookies[0])
        && timingSafeEqual(Buffer.from(cookies[0]), Buffer.from(nonce))
      const returnedFlow = url.searchParams.getAll('sb_flow_id')
      if (!started || !matched || returnedFlow.length > 1 || (returnedFlow.length === 1 && returnedFlow[0] !== flowId)) {
        respond(response, 400, 'Authorization response rejected.', { 'Set-Cookie': clearCookie })
        finish(failure('callback_rejected')); return
      }
      const allowed = ['code', 'sb_flow_id', 'error', 'error_code', 'error_description']
      const codes = url.searchParams.getAll('code')
      const hasError = ['error', 'error_code', 'error_description'].some(k => url.searchParams.has(k))
      if ([...url.searchParams.keys()].some(k => !allowed.includes(k) || url.searchParams.getAll(k).length !== 1)
        || codes.length > 1 || (hasError && codes.length !== 0)) {
        respond(response, 400, 'Authorization response rejected.', { 'Set-Cookie': clearCookie })
        finish(failure('callback_rejected')); return
      }
      if (hasError) {
        respond(response, 400, 'Authorization did not complete. Return to the helper.', { 'Set-Cookie': clearCookie })
        finish(failure('oauth_denied')); return
      }
      const value = codes[0]
      if (!value || !/^[A-Za-z0-9._~-]{1,2048}$/.test(value)) {
        respond(response, 400, 'Authorization response rejected.', { 'Set-Cookie': clearCookie })
        finish(failure('callback_rejected')); return
      }
      respond(response, 200, 'Authorization response received. Return to the helper for verification.', { 'Set-Cookie': clearCookie })
      finish(null, value)
    } catch {
      try { respond(response, 400, 'Authorization response rejected.') } catch { /* No request/error details logged. */ }
      finish(failure('callback_rejected'))
    }
  }
  try {
    if (signal?.aborted) throw failure('interrupted')
    signal?.addEventListener('abort', abort, { once: true })
    for (const host of ['127.0.0.1', '::1']) {
      const server = serverFactory({ maxHeaderSize: 8192, headersTimeout: 5000, requestTimeout: 5000 }, handler)
      server.maxConnections = 4
      server.keepAliveTimeout = 1000
      server.on('clientError', (_error, socket) => socket.destroy())
      servers.push(server)
      await new Promise((resolve, reject) => {
        const onError = error => reject(failure(error.code === 'EADDRINUSE' ? 'callback_port_in_use' : 'callback_unavailable'))
        server.once('error', onError)
        server.listen({ host, port: 5173, ipv6Only: true, exclusive: true }, () => {
          server.removeListener('error', onError)
          server.on('error', () => finish(failure('callback_unavailable')))
          resolve()
        })
      })
    }
    if (signal?.aborted) throw failure('interrupted')
    timer = setTimeout(() => finish(failure('callback_timeout')), timeoutMs)
    return {
      code, close,
      configure(url, expectedFlow) {
        const u = new URL(url)
        if (authorizationUrl || settled || !/^[A-Za-z0-9_-]{8,64}$/.test(expectedFlow)
          || u.origin !== 'https://mzeuimqfrswrwoaqjdmp.supabase.co' || u.pathname !== '/auth/v1/authorize'
          || u.searchParams.get('provider') !== 'google' || u.searchParams.get('redirect_to') !== GOOGLE_REDIRECT
          || u.searchParams.get('code_challenge_method') !== 's256'
          || !/^[A-Za-z0-9_-]{43}$/.test(u.searchParams.get('code_challenge') ?? '')) throw failure('oauth_failed')
        authorizationUrl = u.href; flowId = expectedFlow
      },
      startUrl: 'http://' + HOST + START + '?nonce=' + nonce,
    }
  } catch (error) { await close(); throw error instanceof GooglePkceError ? error : failure('callback_unavailable') }
}

export async function googlePkceSignIn(client, options = {}) {
  const callback = await createGoogleCallback({ timeoutMs: options.oauthTimeoutMs,
    signal: options.signal, serverFactory: options.serverFactory })
  let value, flowId
  try {
    const start = await client.auth.signInWithOAuth({ provider: 'google',
      options: { redirectTo: GOOGLE_REDIRECT, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } } })
    if (start.error) throw failure('oauth_failed')
    flowId = start.data.flowId
    callback.configure(start.data.url, flowId)
    const opening = Promise.resolve().then(() => (options.openBrowser ?? openSystemBrowser)(callback.startUrl))
    await Promise.race([opening, callback.code.then(() => undefined)])
    value = await callback.code
  } catch (error) { throw error instanceof GooglePkceError ? error : failure('browser_open_failed') }
  finally { await callback.close() }
  if (options.signal?.aborted) throw failure('interrupted')
  // Always select the retained flow's verifier, never a callback-selected slot.
  return client.auth.exchangeCodeForSession(value, { flowId })
}
