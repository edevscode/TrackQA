import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDatabaseEndpoint } from '../database-endpoint.ts'
import { createEndpoint } from '../handler.ts'

const internal = 'edge-runtime.supabase.com'
const token = `tqm_${'a'.repeat(64)}`
function harness() {
  let calls = 0
  const endpoint = createDatabaseEndpoint({ supabaseUrl: 'https://database.test', serviceRoleKey: 'synthetic-server-key',
    allowedHostnames: ['database.test', internal],
    fetch: async url => {
      calls++
      assert.equal(String(url), 'https://database.test/rest/v1/rpc/resolve_mcp_connection')
      return Response.json([])
    } })
  return { endpoint, count: () => calls }
}
function request(host: string | null = internal, authorization?: string, extra: Record<string, string> = {}) {
  return new Request('https://database.test/functions/v1/trackqa-mcp', {
    method: 'POST', headers: { ...(host === null ? {} : { Host: host }),
      ...(authorization === undefined ? {} : { Authorization: authorization }), ...extra }, body: '{}',
  })
}
async function unauthorized(response: Response) {
  assert.equal(response.status, 401)
  assert.equal(response.headers.get('www-authenticate'), 'Bearer realm="trackqa-mcp"')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), { error: 'Authentication required.' })
}

test('public and exact internal gateway hostnames reach custom authentication, including valid port/case forms', async () => {
  const h = harness()
  for (const host of ['database.test', internal, `${internal}:443`, internal.toUpperCase()]) {
    await unauthorized(await h.endpoint.fetch(request(host)))
  }
  assert.equal(h.count(), 0)
})

test('internal Host cannot authenticate missing/malformed or unissued bearer tokens', async () => {
  const h = harness()
  for (const credential of [undefined, '', 'Bearer malformed', 'Basic wrong', `Bearer ${token}`]) {
    await unauthorized(await h.endpoint.fetch(request(internal, credential)))
  }
  assert.equal(h.count(), 1, 'only a well-formed credential may reach the existing resolver')
})

test('arbitrary, lookalike, missing and loopback Hosts remain denied by the configured production endpoint', async () => {
  const h = harness()
  for (const host of [null, '', 'attacker.test', `${internal}.attacker.test`, `evil-${internal}`,
    'supabase.com', 'database.test.attacker.test', 'localhost', '127.0.0.1']) {
    assert.equal((await h.endpoint.fetch(request(host, `Bearer ${token}`))).status, 403)
  }
  assert.equal(h.count(), 0)
})

test('malformed Host authorities cannot be URL-normalized into an allowlisted hostname', async () => {
  const h = harness()
  for (const host of [`attacker@${internal}`, `${internal}/path`, `${internal}\\path`, `${internal}?query`,
    `${internal}#fragment`, '%65dge-runtime.supabase.com', `${internal},attacker.test`, `${internal}:`, `${internal}:65536`]) {
    assert.equal((await h.endpoint.fetch(request(host, `Bearer ${token}`))).status, 403)
  }
  assert.equal(h.count(), 0)
})

test('all unapproved browser Origins stay denied even on the internal Host and with a bearer token', async () => {
  const h = harness()
  for (const origin of ['https://attacker.test', `https://${internal}`, 'https://database.test', 'null', 'not-an-origin']) {
    assert.equal((await h.endpoint.fetch(request(internal, `Bearer ${token}`, { Origin: origin }))).status, 403)
  }
  assert.equal(h.count(), 0)
})

test('Forwarded and X-Forwarded-Host cannot repair an untrusted actual Host or Origin', async () => {
  const h = harness()
  const forged = { 'X-Forwarded-Host': internal, Forwarded: `host=${internal};proto=https` }
  assert.equal((await h.endpoint.fetch(request('attacker.test', `Bearer ${token}`, forged))).status, 403)
  assert.equal((await h.endpoint.fetch(request(internal, `Bearer ${token}`, { ...forged, Origin: 'https://attacker.test' }))).status, 403)
  await unauthorized(await h.endpoint.fetch(request(internal, undefined, { 'X-Forwarded-Host': 'attacker.test', Forwarded: 'host=attacker.test' })))
  assert.equal(h.count(), 0)
})

test('generic endpoint defaults do not acquire the hosted exception', async () => {
  let authorizations = 0
  const endpoint = createEndpoint({ authorize: async () => { authorizations++; return null } })
  assert.equal((await endpoint.fetch(request(internal, `Bearer ${token}`))).status, 403)
  assert.equal(authorizations, 0)
})
