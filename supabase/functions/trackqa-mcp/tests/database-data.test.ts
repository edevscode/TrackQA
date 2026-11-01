import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createDatabaseEndpoint } from '../database-endpoint.ts'
import { createDatabaseDataAccess } from '../database-data.ts'
import { createDatabaseRpc, MAX_DATABASE_RESPONSE_BYTES } from '../database-rpc.ts'
import type { RpcDiagnostic, RpcOperation } from '../database-rpc.ts'
import { createBearerAuthorizer } from '../bearer-auth.ts'
import { createEndpoint } from '../handler.ts'
import { createMockDataAccess, MOCK_PROJECT_ID, OTHER_PROJECT_ID, MOCK_ISSUE_ID, OTHER_ISSUE_ID } from '../mock-data.ts'
import { MAX_TOOL_RESULT_BYTES } from '../tools.ts'

// Synthetic fixtures only. All HTTP calls are injected; there is no network
// listener or live fetch. Empty RPC rows model SQL authorization denials.
const TOKEN_A = `tqm_${'a'.repeat(64)}`
const TOKEN_B = `tqm_${'b'.repeat(64)}`
const HASH_A = createHash('sha256').update(TOKEN_A).digest('hex')
const HASH_B = createHash('sha256').update(TOKEN_B).digest('hex')
const KEY = 'synthetic-server-key-never-a-live-credential'
const rowA = { connection_id: '66666666-6666-4666-8666-666666666666', user_id: '77777777-7777-4777-8777-777777777777', project_id: MOCK_PROJECT_ID }
const rowB = { connection_id: '88888888-8888-4888-8888-888888888888', user_id: '99999999-9999-4999-8999-999999999999', project_id: OTHER_PROJECT_ID }
const access = { connectionId: rowA.connection_id, userId: rowA.user_id, projectId: rowA.project_id,
  approved: true, isMember: true, mcpEnabled: true, projectArchived: false, revoked: false }
const mock = createMockDataAccess()

test('backend transport accepts modern secret keys via apikey and retains legacy authorization', async () => {
  for (const key of ['sb_secret_' + 'synthetic_'.repeat(5), KEY]) {
    let calls = 0
    const modern = key.startsWith('sb_secret_')
    const rpc = createDatabaseRpc({ supabaseUrl: 'https://database.test', serviceRoleKey: key,
      fetch: async (_url, init) => {
        calls++
        const headers = new Headers(init?.headers)
        assert.equal(headers.get('apikey'), key)
        assert.equal(headers.get('Authorization'), modern ? null : `Bearer ${key}`)
        assert.ok(!String(init?.body).includes(key))
        return Response.json([])
      } })
    assert.deepEqual(await rpc('resolve_mcp_connection', { p_token_hash: HASH_A }), [])
    assert.equal(calls, 1)
  }
})

test('publishable, malformed and unknown modern key types fail before a database request', async () => {
  for (const key of ['sb_publishable_' + 'x'.repeat(40), 'sb_secret_', 'sb_secret_synthetic', 'sb_other_' + 'x'.repeat(40)]) {
    let calls = 0
    const rpc = createDatabaseRpc({ supabaseUrl: 'https://database.test', serviceRoleKey: key,
      fetch: async () => { calls++; return Response.json([]) } })
    await assert.rejects(rpc('resolve_mcp_connection', { p_token_hash: HASH_A }), { code: 'configuration' })
    assert.equal(calls, 0)
  }
})
type Args = Record<string, any>
type Override = (operation: string, args: Args) => Response | undefined | Promise<Response | undefined>

function request(name: string, args = {}, token: string | null = TOKEN_A, method = 'tools/call') {
  return new Request('http://mcp.test/mcp', {
    method: 'POST', headers: {
      Host: 'mcp.test', Accept: 'application/json', 'Content-Type': 'application/json',
      'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': method,
      ...(method === 'tools/call' ? { 'Mcp-Name': name } : {}),
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: {
      ...(method === 'tools/call' ? { name, arguments: args } : {}), _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name: 'offline-test', version: '1' },
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    } }),
  })
}

function harness(override?: Override, timeoutMs = 5000) {
  const calls: { operation: string; args: Args }[] = []
  const diagnostics: Readonly<RpcDiagnostic>[] = []
  const state = { authorized: true, readAllowed: true }
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const operation = String(url).split('/').at(-1)!
    const args: Args = JSON.parse(String(init?.body))
    calls.push({ operation, args })
    assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${KEY}`)
    assert.equal(new Headers(init?.headers).get('apikey'), KEY)
    assert.equal(init?.redirect, 'error')
    const custom = await override?.(operation, args)
    if (custom) return custom
    const row = args.p_token_hash === HASH_A ? rowA : args.p_token_hash === HASH_B ? rowB : null
    if (!row || !state.authorized) return Response.json([])
    if (operation === 'resolve_mcp_connection') return Response.json([row])
    if (!state.readAllowed) return Response.json([])
    if (operation === 'mcp_list_projects') {
      const project = await mock.getProject(row.project_id)
      return Response.json(project ? [project] : [])
    }
    if (operation === 'mcp_list_issues') {
      const { issues } = await mock.listIssues(row.project_id, { limit: args.p_limit, offset: args.p_offset, status: args.p_status ?? undefined })
      return Response.json(issues)
    }
    if (operation === 'mcp_get_issue') {
      const issue = await mock.getIssue(row.project_id, args.p_issue_id)
      return Response.json(issue ? [issue] : [])
    }
    throw new Error('Unexpected mocked RPC')
  }
  const endpoint = createDatabaseEndpoint({
    supabaseUrl: 'https://database.test', serviceRoleKey: KEY, fetch, timeoutMs,
    allowedHostnames: ['mcp.test'], diagnose: (event) => diagnostics.push(event),
  })
  return { endpoint, calls, diagnostics, state }
}

async function call(h: ReturnType<typeof harness>, name: string, args = {}, token = TOKEN_A) {
  const response = await h.endpoint.fetch(request(name, args, token))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const text = await response.text()
  for (const secret of [TOKEN_A, TOKEN_B, HASH_A, HASH_B, KEY]) assert.ok(!text.includes(secret), 'private credential must never appear in MCP output')
  return JSON.parse(text).result
}

function failure(result: any) {
  assert.equal(result.isError, true)
  assert.equal(result.structuredContent, undefined)
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < MAX_TOOL_RESULT_BYTES)
}

test('all four tools use the checked RPCs with actual SQL argument names and row-array shapes', async () => {
  const h = harness()
  const status = (await call(h, 'trackqa_connection_status')).structuredContent
  assert.equal(status.data_source, 'database')
  assert.equal(status.database_connected, true)
  assert.equal(status.connection_id, rowA.connection_id)
  assert.deepEqual((await call(h, 'trackqa_list_projects')).structuredContent.projects, [await mock.getProject(MOCK_PROJECT_ID)])
  const list = (await call(h, 'trackqa_list_issues', { project_id: MOCK_PROJECT_ID })).structuredContent
  assert.equal(list.issues.length, 2)
  assert.equal(list.next_offset, null)
  assert.equal(list.issues[0].description, undefined)
  assert.deepEqual((await call(h, 'trackqa_get_issue', { issue_id: MOCK_ISSUE_ID })).structuredContent.issue, await mock.getIssue(MOCK_PROJECT_ID, MOCK_ISSUE_ID))
  assert.deepEqual(h.calls.filter((call) => call.operation !== 'resolve_mcp_connection'), [
    { operation: 'mcp_list_projects', args: { p_token_hash: HASH_A } },
    { operation: 'mcp_list_projects', args: { p_token_hash: HASH_A } },
    { operation: 'mcp_list_issues', args: { p_token_hash: HASH_A, p_limit: 20, p_offset: 0, p_status: null } },
    { operation: 'mcp_get_issue', args: { p_token_hash: HASH_A, p_issue_id: MOCK_ISSUE_ID } },
  ])
  const sql = await readFile(new URL('../../../migrations/0033_mcp_foundation.sql', import.meta.url), 'utf8')
  assert.match(sql, /mcp_list_projects\(p_token_hash text\)/)
  assert.match(sql, /mcp_list_issues\(\s*p_token_hash text,\s*p_limit integer default 20,\s*p_offset integer default 0,\s*p_status public\.issue_status default null/)
  assert.match(sql, /mcp_get_issue\(p_token_hash text, p_issue_id uuid\)/)
})

test('production and mock tools preserve identical input schemas; mock adapter stays available', async () => {
  const h = harness()
  const mockEndpoint = createEndpoint({ allowedHostnames: ['mcp.test'], authorize: async () => access })
  const production = await (await h.endpoint.fetch(request('', {}, TOKEN_A, 'tools/list'))).json()
  const fixture = await (await mockEndpoint.fetch(request('', {}, TOKEN_A, 'tools/list'))).json()
  assert.deepEqual(production.result.tools.map((tool: any) => [tool.name, tool.inputSchema]), fixture.result.tools.map((tool: any) => [tool.name, tool.inputSchema]))
  assert.equal(h.calls.length, 1, 'discovery does not perform data reads')
  const status = await (await mockEndpoint.fetch(request('trackqa_connection_status'))).json()
  assert.equal(status.result.structuredContent.data_source, 'mock')
  assert.equal(status.result.structuredContent.database_connected, false)
})

test('database adapter supports delayed reads over legacy Streamable HTTP versions', async () => {
  const h = harness(async () => { await new Promise((done) => setTimeout(done, 2)); return undefined })
  for (const version of ['2025-03-26', '2025-06-18', '2025-11-25']) {
    const response = await h.endpoint.fetch(new Request('http://mcp.test/mcp', {
      method: 'POST', headers: {
        Host: 'mcp.test', Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json',
        'MCP-Protocol-Version': version, Authorization: `Bearer ${TOKEN_A}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'trackqa_list_projects', arguments: {} } }),
    }))
    assert.equal(response.status, 200)
    const text = await response.text()
    assert.ok(!text.includes(HASH_A))
    const messages = text.split('\n').filter((line) => line.startsWith('data: '))
    assert.equal(messages.length, 1)
    const result = JSON.parse(messages[0].slice(6)).result
    assert.equal(result.structuredContent.data_source, 'database')
    assert.equal(result.structuredContent.projects[0].id, MOCK_PROJECT_ID)
  }
})

for (const reason of ['revoked', 'expired', 'MCP disabled', 'archived', 'membership removed', 'unapproved']) {
  test(`${reason}: auth denial prevents reads; a change after auth is independently denied by read RPCs`, async () => {
    const h = harness()
    h.state.authorized = false
    const denied = await h.endpoint.fetch(request('trackqa_list_projects'))
    assert.equal(denied.status, 401)
    assert.deepEqual(await denied.json(), { error: 'Authentication required.' })
    assert.deepEqual(h.calls.map((call) => call.operation), ['resolve_mcp_connection'])
    h.state.authorized = true
    h.state.readAllowed = false
    failure(await call(h, 'trackqa_connection_status'))
    assert.deepEqual((await call(h, 'trackqa_list_projects')).structuredContent.projects, [])
    assert.deepEqual((await call(h, 'trackqa_list_issues', { project_id: MOCK_PROJECT_ID })).structuredContent.issues, [])
    failure(await call(h, 'trackqa_get_issue', { issue_id: MOCK_ISSUE_ID }))
    assert.equal(h.calls.filter((call) => call.operation !== 'resolve_mcp_connection').length, 4)
  })
}

test('foreign project arguments are rejected before reads; foreign/missing issues reveal no data', async () => {
  const h = harness()
  failure(await call(h, 'trackqa_list_issues', { project_id: OTHER_PROJECT_ID }))
  assert.deepEqual(h.calls.map((call) => call.operation), ['resolve_mcp_connection'])
  const foreign = await call(h, 'trackqa_get_issue', { issue_id: OTHER_ISSUE_ID })
  const missing = await call(h, 'trackqa_get_issue', { issue_id: '00000000-0000-4000-8000-000000000000' })
  failure(foreign)
  assert.deepEqual(foreign, missing)
  const spoofed = request('trackqa_list_projects')
  spoofed.headers.set('X-User-Id', rowB.user_id)
  spoofed.headers.set('X-Project-Id', rowB.project_id)
  spoofed.headers.set('X-Connection-Id', rowB.connection_id)
  const result = await (await h.endpoint.fetch(spoofed)).json()
  assert.equal(result.result.structuredContent.projects[0].id, rowA.project_id)
})

test('defensive validation rejects RPC rows belonging to another project or issue', async () => {
  const foreign = (await mock.getIssue(OTHER_PROJECT_ID, OTHER_ISSUE_ID))!
  for (const name of ['trackqa_connection_status', 'trackqa_list_projects', 'trackqa_list_issues', 'trackqa_get_issue']) {
    const h = harness(async (operation) => {
      if (operation === 'mcp_list_projects') return Response.json([await mock.getProject(OTHER_PROJECT_ID)])
      if (operation === 'mcp_list_issues') { const { description: _description, ...summary } = foreign; return Response.json([summary]) }
      if (operation === 'mcp_get_issue') return Response.json([foreign])
    })
    failure(await call(h, name, name === 'trackqa_list_issues' ? { project_id: MOCK_PROJECT_ID } : name === 'trackqa_get_issue' ? { issue_id: MOCK_ISSUE_ID } : {}))
    assert.equal(h.diagnostics.at(-1)?.code, 'scope')
  }
  const h = harness(async (operation) => operation === 'mcp_get_issue'
    ? Response.json([{ ...(await mock.getIssue(MOCK_PROJECT_ID, MOCK_ISSUE_ID)), id: '44444444-4444-4444-8444-444444444444' }]) : undefined)
  failure(await call(h, 'trackqa_get_issue', { issue_id: MOCK_ISSUE_ID }))
})

test('pagination maps plain SQL arrays, filters statuses, and never produces an out-of-range next offset', async () => {
  const h = harness()
  const page = async (offset: number) => (await call(h, 'trackqa_list_issues', { project_id: MOCK_PROJECT_ID, limit: 1, offset })).structuredContent
  assert.equal((await page(0)).next_offset, 1)
  assert.equal((await page(1)).next_offset, 2, 'a full final page may suggest an empty next page')
  assert.equal((await page(2)).next_offset, null)
  assert.equal((await page(10000)).next_offset, null)
  const filtered = (await call(h, 'trackqa_list_issues', { project_id: MOCK_PROJECT_ID, status: 'OPEN' })).structuredContent
  assert.equal(filtered.issues.length, 1)
  assert.equal(filtered.issues[0].status, 'OPEN')
  assert.equal(h.calls.at(-1)?.args.p_status, 'OPEN')
  const adapter = createDatabaseDataAccess(async () => (await mock.listIssues(MOCK_PROJECT_ID, { limit: 1, offset: 0 })).issues, HASH_A, access)
  assert.equal((await adapter.listIssues(MOCK_PROJECT_ID, { limit: 1, offset: 10000 })).nextOffset, null)
})

test('adapter validates UUIDs, pagination and scope independently and exposes no credential state', async () => {
  let calls = 0
  const adapter = createDatabaseDataAccess(async () => { calls++; return [] }, HASH_A, access)
  assert.deepEqual(Object.keys(adapter).sort(), ['getIssue', 'getProject', 'listIssues', 'submitFinding'])
  await assert.rejects(adapter.getProject(OTHER_PROJECT_ID))
  await assert.rejects(adapter.getIssue(MOCK_PROJECT_ID, 'invalid'))
  for (const change of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { offset: -1 }, { offset: 10001 }, { status: 'INVALID' }]) {
    await assert.rejects(adapter.listIssues(MOCK_PROJECT_ID, { limit: 20, offset: 0, ...change } as any))
  }
  assert.equal(calls, 0)
})

test('malformed, extra-field, duplicate and too-many-row RPC responses fail closed', async () => {
  for (const value of [{ projects: [] }, [rowA], [null], [{ id: MOCK_PROJECT_ID, name: 'ok', key: 'DEMO', token_hash: HASH_A }],
    [await mock.getProject(MOCK_PROJECT_ID), await mock.getProject(MOCK_PROJECT_ID)]]) {
    const h = harness((operation) => operation === 'mcp_list_projects' ? Response.json(value) : undefined)
    failure(await call(h, 'trackqa_list_projects'))
    assert.equal(h.diagnostics.at(-1)?.code, 'invalid_response')
  }
  const issues = (await mock.listIssues(MOCK_PROJECT_ID, { limit: 20, offset: 0 })).issues
  const h = harness((operation) => operation === 'mcp_list_issues' ? Response.json(issues) : undefined)
  failure(await call(h, 'trackqa_list_issues', { project_id: MOCK_PROJECT_ID, limit: 1 }))
})

test('large text within the transport cap is rejected by the serialized MCP result-byte limit without truncation', async () => {
  const issue = (await mock.getIssue(MOCK_PROJECT_ID, MOCK_ISSUE_ID))!
  for (const description of ['x'.repeat(20000), '界'.repeat(6000), '\u0000'.repeat(6000)]) {
    const h = harness((operation) => operation === 'mcp_get_issue' ? Response.json([{ ...issue, description }]) : undefined)
    const result = await call(h, 'trackqa_get_issue', { issue_id: MOCK_ISSUE_ID })
    failure(result)
    assert.match(result.content[0].text, /response limit/)
  }
})

test('oversized database and chunked bodies are cancelled and return generic errors', async () => {
  let cancelled = false
  const h = harness((operation) => {
    if (operation !== 'mcp_get_issue') return
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(MAX_DATABASE_RESPONSE_BYTES)); controller.enqueue(new Uint8Array(1)) },
      cancel() { cancelled = true },
    }), { headers: { 'Content-Length': '1' } })
  })
  failure(await call(h, 'trackqa_get_issue', { issue_id: MOCK_ISSUE_ID }))
  assert.equal(cancelled, true)
  assert.equal(h.diagnostics.at(-1)?.code, 'response_limit')
})

test('database failures produce only generic errors and fixed safe diagnostic fields', async () => {
  for (const makeResponse of [
    () => Response.json({ error: `SQL internal details ${HASH_A} ${KEY}` }, { status: 500 }),
    () => Response.json({ error: 'migration has not been applied' }, { status: 404 }),
    () => Response.redirect('https://evil.test', 307),
    () => new Response(`invalid JSON ${KEY}`),
    () => { throw new Error(`network private detail ${TOKEN_A} ${HASH_A} ${KEY}`) },
  ]) {
    const h = harness((operation) => operation === 'mcp_list_projects' ? makeResponse() : undefined)
    const result = await call(h, 'trackqa_list_projects')
    failure(result)
    assert.equal(result.content[0].text, 'Data unavailable or access denied.')
    assert.equal(h.diagnostics.length, 1)
    const event = h.diagnostics[0]
    assert.equal(event.operation, 'mcp_list_projects')
    assert.deepEqual(Object.keys(event).sort(), event.status === undefined ? ['code', 'operation'] : ['code', 'operation', 'status'])
    const text = JSON.stringify(event)
    for (const secret of [TOKEN_A, HASH_A, KEY, 'SQL', 'private detail']) assert.ok(!text.includes(secret))
  }
})

test('stalled database response bodies are cancelled on timeout', async () => {
  let cancelled = false
  const h = harness((operation) => operation === 'mcp_get_issue' ? new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('[')) },
    cancel() { cancelled = true },
  })) : undefined, 20)
  failure(await call(h, 'trackqa_get_issue', { issue_id: MOCK_ISSUE_ID }))
  assert.equal(cancelled, true)
  assert.equal(h.diagnostics.at(-1)?.code, 'timeout')
})

test('only fixed RPC names are permitted and invalid names cannot enter diagnostics', async () => {
  let calls = 0
  const events: Readonly<RpcDiagnostic>[] = []
  const rpc = createDatabaseRpc({ supabaseUrl: 'https://database.test', serviceRoleKey: KEY,
    fetch: async () => { calls++; return Response.json([]) }, diagnose: (event) => events.push(event) })
  await assert.rejects(rpc(TOKEN_A as RpcOperation, {}))
  assert.equal(calls, 0)
  assert.deepEqual(events, [{ operation: 'unknown', code: 'input' }])
})

test('verified-hash context is created only after a valid resolver row and is never public identity state', async () => {
  const seen: string[] = []
  for (const rows of [[], [rowA, rowB], [{ ...rowA, project_id: null }]]) {
    assert.equal(await createBearerAuthorizer(async () => rows, (hash) => seen.push(hash))(request('trackqa_connection_status')), null)
  }
  assert.equal(seen.length, 0)
  const identity = await createBearerAuthorizer(async () => [rowA], (hash) => seen.push(hash))(request('trackqa_connection_status'))
  assert.deepEqual(seen, [HASH_A])
  assert.ok(!JSON.stringify(identity).includes(HASH_A))
})

test('concurrent connections never exchange private hashes or authorized projects', async () => {
  const h = harness(async () => { await new Promise((done) => setTimeout(done, 2)); return undefined })
  await Promise.all(Array.from({ length: 20 }, async (_, index) => {
    const a = index % 2 === 0
    const projects = (await call(h, 'trackqa_list_projects', {}, a ? TOKEN_A : TOKEN_B)).structuredContent.projects
    assert.deepEqual(projects.map((project: { id: string }) => project.id), [a ? MOCK_PROJECT_ID : OTHER_PROJECT_ID])
  }))
  assert.equal(h.calls.filter((call) => call.operation === 'mcp_list_projects' && call.args.p_token_hash === HASH_A).length, 10)
  assert.equal(h.calls.filter((call) => call.operation === 'mcp_list_projects' && call.args.p_token_hash === HASH_B).length, 10)
})
