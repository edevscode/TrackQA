import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withRequestAdmission } from '../request-admission.ts'
import { createAdmissionRpc, createDatabaseRpc } from '../database-rpc.ts'

const token = `tqm_${'a'.repeat(64)}`
const request = (authorization = `Bearer ${token}`, headers: Record<string, string> = {}) => new Request('https://localhost/mcp', {
  method: 'POST', headers: { Host: 'localhost', Authorization: authorization, 'X-Forwarded-For': 'client-controlled', ...headers },
})

test('rejected Host/Origin requests perform no admission or resolver work', async () => {
  let admissions = 0
  let downstream = 0
  const endpoint = withRequestAdmission({ fetch: async () => { downstream++; return new Response(null, { status: 204 }) } },
    async () => { admissions++; return [{ allowed: true, retry_after_seconds: 0 }] })
  const cases: Record<string, string>[] = [{ Host: 'attacker.test' }, { Origin: 'https://attacker.test' },
    { Origin: 'https://localhost' }]
  for (const headers of cases) {
    const response = await endpoint.fetch(request(undefined, headers))
    assert.ok(response.status >= 400 && response.status < 500)
    await response.body?.cancel()
  }
  assert.equal(admissions, 0)
  assert.equal(downstream, 0)
})

test('deployment Host/Origin configuration is used before admission', async () => {
  let admissions = 0
  const endpoint = withRequestAdmission({ fetch: async () => new Response(null, { status: 204 }) },
    async () => { admissions++; return [{ allowed: true, retry_after_seconds: 0 }] },
    { allowedHostnames: ['database.test'], allowedOriginHostnames: ['review.test'] })
  assert.equal((await endpoint.fetch(request(undefined, { Host: 'localhost' }))).status, 403)
  assert.equal((await endpoint.fetch(request(undefined, { Host: 'database.test', Origin: 'https://review.test' }))).status, 204)
  assert.equal(admissions, 1)
})

test('missing/malformed credentials retain cheap existing authentication behavior', async () => {
  let admissions = 0
  const endpoint = withRequestAdmission({ fetch: async () => new Response(null, { status: 401 }) },
    async () => { admissions++; throw new Error('must not run') })
  for (const credential of ['', 'Bearer malformed', 'Basic wrong']) {
    assert.equal((await endpoint.fetch(request(credential))).status, 401)
  }
  assert.equal(admissions, 0)
})

test('admitted requests preserve the original Request and downstream behavior', async () => {
  const original = request()
  const endpoint = withRequestAdmission({ fetch: async (value) => {
    assert.equal(value, original)
    return new Response('unchanged', { status: 202 })
  } }, async () => [{ allowed: true, retry_after_seconds: 0 }])
  assert.equal((await endpoint.fetch(original)).status, 202)
})

test('budget exhaustion denies lookups without revealing credential eligibility', async () => {
  const endpoint = withRequestAdmission({ fetch: async () => { throw new Error('downstream must not run') } },
    async () => [{ allowed: false, retry_after_seconds: 1 }])
  const response = await endpoint.fetch(request())
  assert.equal(response.status, 429)
  assert.equal(response.headers.get('retry-after'), '1')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal((await response.text()).includes(token), false)
})

test('unavailable, ambiguous and malformed admission results fail closed', async () => {
  for (const result of [[], [{ allowed: true }], [{ allowed: true, retry_after_seconds: 1 }],
    [{ allowed: true, retry_after_seconds: 0, extra: true }], [{ allowed: false, retry_after_seconds: 0 }]]) {
    const endpoint = withRequestAdmission({ fetch: async () => { throw new Error('must not run') } }, async () => result)
    assert.equal((await endpoint.fetch(request())).status, 503)
  }
  const endpoint = withRequestAdmission({ fetch: async () => { throw new Error('must not run') } },
    async () => { throw new Error(`private ${token}`) })
  const response = await endpoint.fetch(request())
  assert.equal(response.status, 503)
  assert.equal((await response.text()).includes(token), false)
})

test('independent Edge wrappers consult the same backend, regardless of token or IP headers', async () => {
  let remaining = 2
  let calls = 0
  const admit = async () => { calls++; return [{ allowed: remaining-- > 0, retry_after_seconds: remaining >= 0 ? 0 : 1 }] }
  const endpoints = [0, 1].map(() => withRequestAdmission({ fetch: async () => new Response(null, { status: 204 }) }, admit))
  const responses = await Promise.all(Array.from({ length: 5 }, (_, i) => endpoints[i % 2].fetch(request(`Bearer tqm_${String(i).repeat(64)}`))))
  assert.deepEqual(responses.map(r => r.status), [204, 204, 429, 429, 429])
  assert.equal(calls, 5)
})

test('admission has a separate fixed RPC and sends neither token, hash nor client-selected bucket', async () => {
  const key = 'synthetic-server-key'
  let calls = 0
  const options = { supabaseUrl: 'https://database.test', serviceRoleKey: key, fetch: async (url: string | URL | Request, init?: RequestInit) => {
    calls++
    assert.equal(String(url), 'https://database.test/rest/v1/rpc/admit_mcp_request')
    assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${key}`)
    assert.equal(init?.body, '{}')
    assert.equal(init?.redirect, 'error')
    return Response.json([{ allowed: true, retry_after_seconds: 0 }])
  } }
  assert.deepEqual(await createAdmissionRpc(options)(), [{ allowed: true, retry_after_seconds: 0 }])
  await assert.rejects(createDatabaseRpc(options)('admit_mcp_request' as any, {}))
  assert.equal(calls, 1)
})

test('admission response bytes are bounded and diagnostics contain no server error details', async () => {
  const diagnostics: unknown[] = []
  const rpc = createAdmissionRpc({ supabaseUrl: 'https://database.test', serviceRoleKey: 'synthetic-server-key',
    fetch: async () => new Response('x'.repeat(1025)), diagnose: event => diagnostics.push(event) })
  await assert.rejects(rpc(), /Data unavailable or access denied/)
  assert.deepEqual(diagnostics, [{ operation: 'admit_mcp_request', code: 'response_limit' }])
})

test('unverified tokens exhaust the same budget as legitimate clients, then admission can recover', async () => {
  // A regression documenting the unresolved global-budget availability defect,
  // not evidence of fairness. The backend is mocked; real state is tested in PGlite.
  let credits = 60
  let admissions = 0
  let resolverCalls = 0
  const legitimate = `Bearer tqm_${'b'.repeat(64)}`
  const endpoint = withRequestAdmission({ fetch: async request => {
    resolverCalls++
    return new Response(null, { status: request.headers.get('authorization') === legitimate ? 204 : 401 })
  } }, async () => {
    admissions++
    const allowed = credits > 0
    if (allowed) credits--
    return [{ allowed, retry_after_seconds: allowed ? 0 : 1 }]
  })
  for (let i = 0; i < 60; i++) assert.equal((await endpoint.fetch(request())).status, 401)
  assert.equal((await endpoint.fetch(request(legitimate))).status, 429)
  assert.equal(admissions, 61) // Even the rejected request reached the database gate.
  assert.equal(resolverCalls, 60)
  credits = 1 // A backend refill becomes visible on the next request; no sticky denial cache.
  assert.equal((await endpoint.fetch(request(legitimate))).status, 204)
})

test('IP/identity headers cannot select another budget or change overload responses', async () => {
  let calls = 0
  const endpoint = withRequestAdmission({ fetch: async () => { throw new Error('must not run') } },
    async () => { calls++; return [{ allowed: false, retry_after_seconds: 1 }] })
  let expected: string | undefined
  const cases: Record<string, string>[] = [
    { 'X-Forwarded-For': '192.0.2.1', 'X-Real-IP': '192.0.2.2', 'X-Project-ID': 'fake-a' },
    { 'X-Forwarded-For': '198.51.100.1', Forwarded: 'for=203.0.113.1', 'X-User-ID': 'fake-b' },
  ]
  for (const headers of cases) {
    const response = await endpoint.fetch(request(undefined, headers))
    assert.equal(response.status, 429)
    const body = await response.text()
    expected ??= body
    assert.equal(body, expected)
    assert.equal(body.includes(token), false)
  }
  assert.equal(calls, 2)
})

test('a stalled admission response times out, fails closed, and does not retry', async () => {
  let calls = 0
  let downstream = 0
  let cancelled = false
  const events: unknown[] = []
  const admit = createAdmissionRpc({ supabaseUrl: 'https://database.test', serviceRoleKey: 'synthetic-server-key',
    fetch: async () => {
      calls++
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('[')) },
        cancel() { cancelled = true },
      }))
    }, diagnose: event => events.push(event) })
  const endpoint = withRequestAdmission({ fetch: async () => { downstream++; return new Response(null, { status: 204 }) } }, admit)
  const response = await endpoint.fetch(request())
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(await response.text(), JSON.stringify({ error: 'Service temporarily unavailable.' }))
  assert.equal(calls, 1)
  assert.equal(downstream, 0)
  assert.equal(cancelled, true)
  assert.deepEqual(events, [{ operation: 'admit_mcp_request', code: 'timeout' }])
})
