import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createBearerAuthorizer } from '../bearer-auth.ts'
import { createDatabaseTokenResolver, MAX_RESOLVER_RESPONSE_BYTES } from '../token-resolver.ts'
import { createEndpoint } from '../handler.ts'
import { MOCK_PROJECT_ID, OTHER_PROJECT_ID, OTHER_ISSUE_ID } from '../mock-data.ts'

// Deterministic synthetic fixtures, never issued credentials. Every transport
// below is injected; no test calls global fetch or any Supabase service.
const TOKEN_A = `tqm_${'a'.repeat(64)}`
const TOKEN_B = `tqm_${'b'.repeat(64)}`
const HASH_A = createHash('sha256').update(TOKEN_A).digest('hex')
const HASH_B = createHash('sha256').update(TOKEN_B).digest('hex')
const SERVER_KEY = 'synthetic-server-key-for-mocked-requests-only'
const rowA = {
  connection_id: '66666666-6666-4666-8666-666666666666',
  user_id: '77777777-7777-4777-8777-777777777777', project_id: MOCK_PROJECT_ID,
}
const rowB = {
  connection_id: '88888888-8888-4888-8888-888888888888',
  user_id: '99999999-9999-4999-8999-999999999999', project_id: OTHER_PROJECT_ID,
}
const endpointFor = (resolve: (hash: string) => Promise<unknown>) => createEndpoint({
  allowedHostnames: ['mcp.test'], authorize: createBearerAuthorizer(resolve),
})

function authRequest(authorization?: string) {
  return new Request('http://mcp.test/mcp', { headers: authorization === undefined ? {} : { Authorization: authorization } })
}

function mcpRequest(name = 'trackqa_connection_status', args = {}, token: string | null = TOKEN_A) {
  return new Request('http://mcp.test/mcp', {
    method: 'POST', headers: {
      Host: 'mcp.test', Accept: 'application/json', 'Content-Type': 'application/json',
      'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': name,
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
      name, arguments: args, _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name: 'offline-test', version: '1' },
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    } }),
  })
}

function databaseResolver(fetch: typeof globalThis.fetch, extra: { timeoutMs?: number } = {}) {
  return createDatabaseTokenResolver({ supabaseUrl: 'https://database.test', serviceRoleKey: SERVER_KEY, fetch, ...extra })
}

async function assertUnauthorized(response: Response) {
  assert.equal(response.status, 401)
  assert.equal(response.headers.get('www-authenticate'), 'Bearer realm="trackqa-mcp"')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), { error: 'Authentication required.' })
}

test('Web Crypto hashes the complete token and identity comes exclusively from the resolver', async () => {
  const received: string[] = []
  const authorize = createBearerAuthorizer(async (hash) => { received.push(hash); return [rowA] })
  const request = authRequest(`bEaReR  ${TOKEN_A}`)
  request.headers.set('X-User-Id', rowB.user_id)
  request.headers.set('X-Project-Id', rowB.project_id)
  request.headers.set('X-Connection-Id', rowB.connection_id)
  const identity = await authorize(request)
  assert.deepEqual(received, [HASH_A])
  assert.deepEqual(identity, {
    connectionId: rowA.connection_id, userId: rowA.user_id, projectId: rowA.project_id,
    approved: true, isMember: true, mcpEnabled: true, projectArchived: false, revoked: false,
  })
  assert.ok(Object.isFrozen(identity))
})

test('missing, empty, malformed and alternate credentials are denied without resolver calls', async () => {
  let calls = 0
  const authorize = createBearerAuthorizer(async () => { calls++; return [rowA] })
  for (const value of [
    undefined, '', 'Bearer', 'Bearer ', 'Basic anything', `Token ${TOKEN_A}`, `Bearer\t${TOKEN_A}`,
    `Bearer ${TOKEN_A} extra`, `Bearer ${TOKEN_A}, Bearer ${TOKEN_B}`, `Bearer ${TOKEN_A},${TOKEN_B}`,
    `Bearer ${TOKEN_A.toUpperCase()}`, `Bearer tqm_${'g'.repeat(64)}`, `Bearer tqm_${'a'.repeat(63)}`,
    `Bearer tqm_${'a'.repeat(65)}`, `Bearer ${HASH_A}`, `Bearer ${rowA.connection_id}`,
    'Bearer eyJhbGciOiJIUzI1NiJ9.synthetic.jwt', `Bearer ${SERVER_KEY}`, 'Bearer ' + 'a'.repeat(20_000),
  ]) assert.equal(await authorize(authRequest(value)), null)
  const duplicate = authRequest(`Bearer ${TOKEN_A}`)
  duplicate.headers.append('Authorization', `Bearer ${TOKEN_B}`)
  assert.equal(await authorize(duplicate), null)
  const alternate = new Request(`http://mcp.test/mcp?access_token=${TOKEN_A}&project_id=${rowA.project_id}`, {
    method: 'POST', headers: { Cookie: `token=${TOKEN_A}` }, body: JSON.stringify({ token: TOKEN_A }),
  })
  assert.equal(await authorize(alternate), null)
  assert.equal(calls, 0)
})

test('well-formed but unknown tokens and missing credentials receive identical unauthorized responses', async () => {
  const endpoint = endpointFor(async () => [])
  await assertUnauthorized(await endpoint.fetch(mcpRequest('trackqa_list_projects')))
  await assertUnauthorized(await endpoint.fetch(mcpRequest('trackqa_list_projects', {}, null)))
})

test('discovery requires bearer authorization before exposing tool schemas', async () => {
  for (const token of [null, TOKEN_A]) {
    const request = mcpRequest('unused', {}, token)
    request.headers.set('Mcp-Method', 'tools/list')
    request.headers.delete('Mcp-Name')
    const body = JSON.parse(await request.text())
    body.method = 'tools/list'
    delete body.params.name
    delete body.params.arguments
    const response = await endpointFor(async () => []).fetch(new Request(request.url, {
      method: 'POST', headers: request.headers, body: JSON.stringify(body),
    }))
    await assertUnauthorized(response)
  }
})

for (const version of ['2025-03-26', '2025-06-18', '2025-11-25']) {
  test(`legacy protocol initialization also uses bearer authentication: ${version}`, async () => {
    let calls = 0
    const endpoint = endpointFor(async () => { calls++; return [rowA] })
    const request = new Request('http://mcp.test/mcp', {
      method: 'POST', headers: {
        Host: 'mcp.test', Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json', 'MCP-Protocol-Version': version, Authorization: `Bearer ${TOKEN_A}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: version, capabilities: {}, clientInfo: { name: 'offline-test', version: '1' },
      } }),
    })
    const response = await endpoint.fetch(request)
    assert.equal(response.status, 200)
    const messages = (await response.text()).split('\n').filter((line) => line.startsWith('data: '))
    assert.equal(messages.length, 1)
    assert.equal(JSON.parse(messages[0].slice(6)).result.protocolVersion, version)
    assert.equal(calls, 1)
  })
}

// SQL owns these eligibility decisions and returns zero rows for each case.
// These mocked tests verify the Edge denial path, not SQL predicate execution.
for (const reason of ['expired token', 'revoked connection', 'unapproved connection',
  'disabled MCP project', 'removed membership', 'archived project', 'deleted linked user']) {
  test(`${reason}: resolver denial blocks every tool`, async () => {
    let calls = 0
    const endpoint = endpointFor(async (hash) => { calls++; assert.equal(hash, HASH_A); return [] })
    for (const name of ['trackqa_connection_status', 'trackqa_list_projects', 'trackqa_list_issues', 'trackqa_get_issue']) {
      await assertUnauthorized(await endpoint.fetch(mcpRequest(name)))
    }
    assert.equal(calls, 4)
  })
}

test('authorization is re-resolved after revocation and project state changes, with no cached identity', async () => {
  for (const state of ['revoked', 'expired', 'disabled', 'membership removed', 'archived']) {
    let active = true
    let calls = 0
    const endpoint = endpointFor(async () => { calls++; return active ? [rowA] : [] })
    assert.equal((await endpoint.fetch(mcpRequest())).status, 200, state)
    active = false
    await assertUnauthorized(await endpoint.fetch(mcpRequest()))
    assert.equal(calls, 2)
  }
})

test('malformed or ambiguous resolver output fails closed', async () => {
  for (const value of [null, undefined, {}, rowA, [rowA, rowB], [null],
    [{ ...rowA, user_id: null }], [{ ...rowA, connection_id: 'invalid' }],
    [{ ...rowA, project_id: undefined }], [{ ...rowA, approved: false }],
  ]) await assertUnauthorized(await endpointFor(async () => value).fetch(mcpRequest()))
})

test('resolver exceptions reveal no database, token or internal error details', async () => {
  const endpoint = endpointFor(async () => { throw new Error(`database error: ${TOKEN_A} ${HASH_A} ${SERVER_KEY}`) })
  await assertUnauthorized(await endpoint.fetch(mcpRequest()))
})

test('valid token preserves MCP project isolation and rejects foreign issue access', async () => {
  const endpoint = endpointFor(async () => [rowA])
  const request = mcpRequest('trackqa_list_projects')
  request.headers.set('X-Project-Id', OTHER_PROJECT_ID)
  const response = await endpoint.fetch(request)
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.deepEqual(data.result.structuredContent.projects.map((project: { id: string }) => project.id), [MOCK_PROJECT_ID])
  for (const request of [
    mcpRequest('trackqa_list_issues', { project_id: OTHER_PROJECT_ID }),
    mcpRequest('trackqa_get_issue', { issue_id: OTHER_ISSUE_ID }),
  ]) {
    const response = await endpoint.fetch(request)
    assert.equal(response.status, 200)
    const rpc = await response.json()
    assert.equal(rpc.result.isError, true)
    assert.equal(rpc.result.structuredContent, undefined)
  }
})

test('fixed server-only RPC receives the hash and server credential, never the agent token or supplied IDs', async () => {
  let calls = 0
  const resolve = databaseResolver(async (url, init) => {
    calls++
    assert.equal(url, 'https://database.test/rest/v1/rpc/resolve_mcp_connection')
    assert.equal(init?.method, 'POST')
    assert.equal(init?.redirect, 'error')
    assert.equal(init?.cache, 'no-store')
    assert.equal(init?.credentials, 'omit')
    assert.ok(init?.signal)
    const headers = new Headers(init?.headers)
    assert.equal(headers.get('Authorization'), `Bearer ${SERVER_KEY}`)
    assert.equal(headers.get('apikey'), SERVER_KEY)
    assert.deepEqual(JSON.parse(String(init?.body)), { p_token_hash: HASH_A })
    assert.ok(!JSON.stringify(init).includes(TOKEN_A))
    return Response.json([rowA])
  })
  const request = mcpRequest()
  request.headers.set('apikey', 'untrusted-client-key')
  request.headers.set('X-User-Id', rowB.user_id)
  const response = await endpointFor(resolve).fetch(request)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).result.structuredContent.connection_id, rowA.connection_id)
  assert.equal(calls, 1)
})

test('database errors, redirects, invalid JSON and oversized responses are generic unauthorized failures', async () => {
  const responses = [
    () => Response.json({ error: SERVER_KEY }, { status: 500 }),
    () => Response.json({ error: 'resolver not installed' }, { status: 404 }),
    () => Response.redirect('https://evil.test/collect', 307),
    () => new Response('not json'),
    () => new Response('x'.repeat(MAX_RESOLVER_RESPONSE_BYTES + 1), { headers: { 'Content-Length': '1' } }),
    () => Response.json([rowA, rowB]),
  ]
  for (const response of responses) {
    await assertUnauthorized(await endpointFor(databaseResolver(async () => response())).fetch(mcpRequest()))
  }
  const thrown = databaseResolver(async () => { throw new Error(`transport error ${SERVER_KEY}`) })
  await assertUnauthorized(await endpointFor(thrown).fetch(mcpRequest()))
})

test('resolver response byte limits also apply to chunked bodies', async () => {
  let cancelled = false
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_RESOLVER_RESPONSE_BYTES))
      controller.enqueue(new Uint8Array(1))
    },
    cancel() { cancelled = true },
  }))
  assert.equal(await databaseResolver(async () => response)(HASH_A), null)
  assert.equal(cancelled, true)
})

test('RPC timeout aborts the request and fails closed', async () => {
  let aborted = false
  const resolve = databaseResolver(async (_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      aborted = true
      reject(new DOMException('Synthetic timeout', 'AbortError'))
    }, { once: true })
  }), { timeoutMs: 10 })
  await assertUnauthorized(await endpointFor(resolve).fetch(mcpRequest()))
  assert.equal(aborted, true)
})

test('missing or unsafe server configuration and malformed hashes make no outgoing requests', async () => {
  let calls = 0
  const fetch: typeof globalThis.fetch = async () => { calls++; return Response.json([rowA]) }
  for (const config of [
    {}, { supabaseUrl: 'https://database.test' }, { serviceRoleKey: SERVER_KEY },
    { supabaseUrl: 'http://database.test', serviceRoleKey: SERVER_KEY },
    { supabaseUrl: 'https://user:password@database.test', serviceRoleKey: SERVER_KEY },
    { supabaseUrl: 'https://database.test/path', serviceRoleKey: SERVER_KEY },
    { supabaseUrl: 'https://database.test?redirect=evil', serviceRoleKey: SERVER_KEY },
    { supabaseUrl: 'https://database.test#evil', serviceRoleKey: SERVER_KEY },
    { supabaseUrl: 'https://database.test', serviceRoleKey: 'sb_secret_synthetic' },
    { supabaseUrl: 'https://database.test', serviceRoleKey: ' ' },
    { supabaseUrl: 'https://database.test', serviceRoleKey: 'synthetic\r\nheader' },
    { supabaseUrl: 'https://database.test', serviceRoleKey: SERVER_KEY, timeoutMs: 0 },
  ]) assert.equal(await createDatabaseTokenResolver({ ...config, fetch })(HASH_A), null)
  const resolve = databaseResolver(fetch)
  for (const hash of ['', TOKEN_A, HASH_A.toUpperCase(), 'x'.repeat(64)]) assert.equal(await resolve(hash), null)
  assert.equal(calls, 0)
})

test('concurrent token resolution does not mix authorized connections', async () => {
  const resolve = databaseResolver(async (_url, init) => {
    const hash = JSON.parse(String(init?.body)).p_token_hash
    await new Promise((done) => setTimeout(done, hash === HASH_A ? 4 : 1))
    return Response.json(hash === HASH_A ? [rowA] : hash === HASH_B ? [rowB] : [])
  })
  const endpoint = endpointFor(resolve)
  await Promise.all(Array.from({ length: 20 }, async (_, index) => {
    const first = index % 2 === 0
    const response = await endpoint.fetch(mcpRequest('trackqa_list_projects', {}, first ? TOKEN_A : TOKEN_B))
    assert.equal(response.status, 200)
    const data = await response.json()
    assert.deepEqual(data.result.structuredContent.projects.map((project: { id: string }) => project.id), [first ? MOCK_PROJECT_ID : OTHER_PROJECT_ID])
  }))
})
