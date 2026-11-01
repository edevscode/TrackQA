import assert from 'node:assert/strict'
import test from 'node:test'
import { createEndpoint, MAX_REQUEST_BYTES } from '../handler.ts'
import type { ConnectionAccess } from '../access.ts'
import { createMockDataAccess, MOCK_PROJECT_ID, OTHER_PROJECT_ID, MOCK_ISSUE_ID, OTHER_ISSUE_ID } from '../mock-data.ts'
import type { DataAccess } from '../mock-data.ts'
import { MAX_TOOL_RESULT_BYTES } from '../tools.ts'

const access: ConnectionAccess = {
  connectionId: '66666666-6666-4666-8666-666666666666',
  userId: '77777777-7777-4777-8777-777777777777', projectId: MOCK_PROJECT_ID,
  approved: true, isMember: true, mcpEnabled: true, projectArchived: false, revoked: false,
}
const hosts = { allowedHostnames: ['mcp.test'] }
const authorized = (data = createMockDataAccess()) => createEndpoint({ ...hosts, authorize: async () => access, data })
type Endpoint = ReturnType<typeof createEndpoint>
type Rpc = { result?: any; error?: { code: number; message: string }; id?: number }

function request(method: string, params: Record<string, unknown> = {}, version = '2025-11-25', headers: Record<string, string> = {}) {
  const modern = version === '2026-07-28'
  return new Request('http://mcp.test/mcp', {
    method: 'POST', headers: {
      Host: 'mcp.test', Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json',
      'MCP-Protocol-Version': version,
      ...(modern ? { 'Mcp-Method': method, ...(typeof params.name === 'string' ? { 'Mcp-Name': params.name } : {}) } : {}),
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: {
      ...params,
      ...(modern ? { _meta: {
        'io.modelcontextprotocol/protocolVersion': version,
        'io.modelcontextprotocol/clientInfo': { name: 'offline-test', version: '1' },
        'io.modelcontextprotocol/clientCapabilities': {},
      } } : {}),
    } }),
  })
}

async function decode(response: Response): Promise<Rpc> {
  const body = await response.text()
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    const messages = body.split('\n').filter((line) => line.startsWith('data: '))
    assert.equal(messages.length, 1, 'one JSON-RPC response per request')
    return JSON.parse(messages[0].slice(6))
  }
  return JSON.parse(body)
}

async function call(endpoint: Endpoint, name: string, args = {}, version = '2025-11-25') {
  const response = await endpoint.fetch(request('tools/call', { name, arguments: args }, version))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('mcp-session-id'), null)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  return decode(response)
}

function assertToolError(rpc: Rpc) {
  assert.ok(rpc.error || rpc.result?.isError === true, 'request must fail')
  assert.equal(rpc.result?.structuredContent, undefined)
}

function monitoredData() {
  let calls = 0
  const mock = createMockDataAccess()
  const data: DataAccess = {
    getProject: async (...args) => { calls++; return mock.getProject(...args) },
    listIssues: async (...args) => { calls++; return mock.listIssues(...args) },
    getIssue: async (...args) => { calls++; return mock.getIssue(...args) },
  }
  return { data, count: () => calls }
}

for (const version of ['2025-03-26', '2025-06-18', '2025-11-25']) {
  test(`legacy initialization and invocation: ${version}`, async () => {
    const endpoint = authorized()
    const response = await endpoint.fetch(request('initialize', {
      protocolVersion: version, capabilities: {}, clientInfo: { name: 'offline-test', version: '1' },
    }, version))
    assert.equal(response.status, 200)
    const rpc = await decode(response)
    assert.equal(rpc.result.protocolVersion, version)
    assert.equal(rpc.result.serverInfo.name, 'trackqa-mcp')
    assert.equal((await call(endpoint, 'trackqa_connection_status', {}, version)).result.structuredContent.data_source, 'mock')
  })
}

test('current protocol discovery and invocation use the actual SDK handler', async () => {
  const endpoint = authorized()
  const response = await endpoint.fetch(request('server/discover', {}, '2026-07-28'))
  assert.equal(response.status, 200)
  assert.deepEqual((await decode(response)).result.supportedVersions, ['2026-07-28'])
  const result = await call(endpoint, 'trackqa_connection_status', {}, '2026-07-28')
  assert.equal(result.result.structuredContent.database_connected, false)
})

for (const version of ['2025-11-25', '2026-07-28']) {
  test(`tool discovery advertises four read tools and one pending-finding submission tool: ${version}`, async () => {
    const response = await authorized().fetch(request('tools/list', {}, version))
    assert.equal(response.status, 200)
    const { tools } = (await decode(response)).result
    assert.deepEqual(tools.map((tool: any) => tool.name).sort(), [
      'trackqa_connection_status', 'trackqa_get_issue', 'trackqa_list_issues', 'trackqa_list_projects', 'trackqa_submit_finding',
    ])
    for (const tool of tools) {
      assert.equal(tool.inputSchema.additionalProperties, false)
      assert.equal(tool.annotations.readOnlyHint, tool.name !== 'trackqa_submit_finding')
      assert.equal(tool.annotations.destructiveHint, false)
    }
  })
}

test('all tools return scoped mock data, pagination and filters', async () => {
  const endpoint = authorized()
  const status = (await call(endpoint, 'trackqa_connection_status')).result.structuredContent
  assert.equal(status.project_id, MOCK_PROJECT_ID)
  assert.equal(status.database_connected, false)
  const projects = (await call(endpoint, 'trackqa_list_projects')).result.structuredContent.projects
  assert.deepEqual(projects.map((row: any) => row.id), [MOCK_PROJECT_ID])
  const first = (await call(endpoint, 'trackqa_list_issues', { project_id: MOCK_PROJECT_ID, limit: 1 })).result.structuredContent
  assert.equal(first.issues.length, 1)
  assert.equal(first.next_offset, 1)
  assert.equal(first.issues[0].description, undefined)
  const second = (await call(endpoint, 'trackqa_list_issues', { project_id: MOCK_PROJECT_ID, limit: 1, offset: 1 })).result.structuredContent
  assert.notEqual(first.issues[0].id, second.issues[0].id)
  assert.equal(second.next_offset, null)
  const filtered = (await call(endpoint, 'trackqa_list_issues', { project_id: MOCK_PROJECT_ID, status: 'OPEN' })).result.structuredContent
  assert.equal(filtered.issues.length, 1)
  assert.equal(filtered.issues[0].status, 'OPEN')
  assert.equal((await call(endpoint, 'trackqa_get_issue', { issue_id: MOCK_ISSUE_ID })).result.structuredContent.issue.id, MOCK_ISSUE_ID)
})

test('default authorization denies discovery and every tool despite spoofed credentials', async () => {
  const spy = monitoredData()
  const endpoint = createEndpoint({ ...hosts, data: spy.data })
  for (const method of ['initialize', 'tools/list', 'tools/call']) {
    const response = await endpoint.fetch(request(method, {
      name: 'trackqa_list_issues', arguments: { project_id: MOCK_PROJECT_ID },
    }, '2025-11-25', { Authorization: 'Bearer fabricated', 'X-Connection-Id': access.connectionId }))
    assert.equal(response.status, 401)
    assert.match(response.headers.get('www-authenticate') ?? '', /^Bearer/)
    assert.equal((await response.json()).error, 'Authentication required.')
  }
  for (const name of ['trackqa_connection_status', 'trackqa_list_projects', 'trackqa_list_issues', 'trackqa_get_issue']) {
    const response = await endpoint.fetch(request('tools/call', { name, arguments: {} }))
    assert.equal(response.status, 401)
  }
  assert.equal(spy.count(), 0)
})

test('authorization exceptions fail closed without exposing internal details', async () => {
  const endpoint = createEndpoint({ ...hosts, authorize: async () => { throw new Error('secret verifier detail') } })
  const response = await endpoint.fetch(request('tools/list'))
  assert.equal(response.status, 503)
  assert.equal(await response.text(), '{"error":"Authorization unavailable."}')
})

for (const change of [
  { revoked: true }, { approved: false }, { isMember: false }, { mcpEnabled: false }, { projectArchived: true },
  { projectId: 'invalid' },
]) {
  test(`invalid or ineligible connection fails closed: ${JSON.stringify(change)}`, async () => {
    const spy = monitoredData()
    const endpoint = createEndpoint({ ...hosts, data: spy.data, authorize: async () => ({ ...access, ...change }) })
    assert.equal((await endpoint.fetch(request('tools/list'))).status, 403)
    assert.equal(spy.count(), 0)
  })
}

const invalidInputs: [string, Record<string, unknown>][] = [
  ['trackqa_connection_status', { extra: true }], ['trackqa_list_projects', { project_id: MOCK_PROJECT_ID }],
  ['trackqa_get_issue', {}], ['trackqa_get_issue', { issue_id: 'not-a-uuid' }],
  ['trackqa_get_issue', { issue_id: MOCK_ISSUE_ID, project_id: MOCK_PROJECT_ID }],
  ['trackqa_list_issues', {}], ['trackqa_list_issues', { project_id: 'invalid' }],
  ...[0, 51, -1, 1.5, '1'].map((limit): [string, Record<string, unknown>] => ['trackqa_list_issues', { project_id: MOCK_PROJECT_ID, limit }]),
  ...[-1, 10_001, 1.5].map((offset): [string, Record<string, unknown>] => ['trackqa_list_issues', { project_id: MOCK_PROJECT_ID, offset }]),
  ['trackqa_list_issues', { project_id: MOCK_PROJECT_ID, status: 'INVALID' }],
  ['trackqa_list_issues', { project_id: MOCK_PROJECT_ID, extra: true }],
]
test('input schemas reject malformed UUIDs, unknown properties and unbounded pagination before data access', async () => {
  const spy = monitoredData()
  const endpoint = authorized(spy.data)
  for (const [name, args] of invalidInputs) assertToolError(await call(endpoint, name, args))
  assert.equal(spy.count(), 0)
})

test('foreign project denied before lookup; foreign and missing issues are indistinguishable', async () => {
  const spy = monitoredData()
  const endpoint = authorized(spy.data)
  assertToolError(await call(endpoint, 'trackqa_list_issues', { project_id: OTHER_PROJECT_ID }))
  assert.equal(spy.count(), 0)
  const foreign = await call(endpoint, 'trackqa_get_issue', { issue_id: OTHER_ISSUE_ID })
  const missing = await call(endpoint, 'trackqa_get_issue', { issue_id: '99999999-9999-4999-8999-999999999999' })
  assertToolError(foreign)
  assert.deepEqual(foreign, missing)
})

test('defensive checks reject a data adapter returning another project', async () => {
  const mock = createMockDataAccess()
  const foreign = await mock.getIssue(OTHER_PROJECT_ID, OTHER_ISSUE_ID)
  assert.ok(foreign)
  const endpoint = authorized({
    getProject: async () => mock.getProject(OTHER_PROJECT_ID),
    getIssue: async () => foreign,
    listIssues: async () => ({ issues: [foreign], nextOffset: null }),
  })
  assertToolError(await call(endpoint, 'trackqa_list_projects'))
  assertToolError(await call(endpoint, 'trackqa_get_issue', { issue_id: MOCK_ISSUE_ID }))
  assertToolError(await call(endpoint, 'trackqa_list_issues', { project_id: MOCK_PROJECT_ID }))
})

test('request and response sizes are bounded by actual bytes', async () => {
  const endpoint = authorized()
  const oversized = request('tools/call', { name: 'trackqa_get_issue', arguments: { issue_id: 'x'.repeat(MAX_REQUEST_BYTES) } })
  oversized.headers.set('Content-Length', '1')
  assert.equal((await endpoint.fetch(oversized)).status, 413)
  const mock = createMockDataAccess()
  const issue = await mock.getIssue(MOCK_PROJECT_ID, MOCK_ISSUE_ID)
  assert.ok(issue)
  const limited = authorized({ ...mock, getIssue: async () => ({ ...issue, description: '界'.repeat(MAX_TOOL_RESULT_BYTES) }) })
  const result = await call(limited, 'trackqa_get_issue', { issue_id: MOCK_ISSUE_ID })
  assertToolError(result)
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < MAX_TOOL_RESULT_BYTES)
})

test('malformed JSON, invalid JSON-RPC, unknown methods and unsupported versions fail', async () => {
  const endpoint = authorized()
  for (const body of ['{', '{}', '[]', '{"jsonrpc":"1.0","id":1,"method":"tools/list"}']) {
    const valid = request('tools/list')
    const response = await endpoint.fetch(new Request(valid.url, { method: 'POST', headers: valid.headers, body }))
    const rpc = await decode(response)
    assert.ok(response.status >= 400 || rpc.error)
    assert.equal(rpc.result, undefined)
  }
  const unknown = await decode(await endpoint.fetch(request('unknown/method')))
  assert.ok(unknown.error)
  const unsupported = await endpoint.fetch(request('tools/list', {}, '2099-01-01'))
  assert.ok(unsupported.status >= 400)
})

test('GET and DELETE do not establish sessions or streams', async () => {
  for (const method of ['GET', 'DELETE']) {
    const response = await authorized().fetch(new Request('http://mcp.test/mcp', { method, headers: { Host: 'mcp.test', Accept: 'text/event-stream' } }))
    assert.equal(response.status, 405)
    assert.equal(response.headers.get('mcp-session-id'), null)
  }
})

test('host and origin checks reject unapproved callers before data access', async () => {
  const spy = monitoredData()
  const endpoint = authorized(spy.data)
  const rejectedHeaders: Record<string, string>[] = [{ Host: 'evil.test' }, { Origin: 'https://evil.test' }]
  for (const headers of rejectedHeaders) {
    assert.equal((await endpoint.fetch(request('tools/list', {}, '2025-11-25', headers))).status, 403)
  }
  assert.equal(spy.count(), 0)
})

test('concurrent requests and repeated stateless calls cannot exchange identities', async () => {
  const endpoint = createEndpoint({ ...hosts, authorize: async (req) => {
    const other = req.headers.get('x-test-principal') === 'other'
    await new Promise((resolve) => setTimeout(resolve, other ? 1 : 4))
    return { ...access, projectId: other ? OTHER_PROJECT_ID : MOCK_PROJECT_ID }
  } })
  const projects = await Promise.all(Array.from({ length: 20 }, async (_, index) => {
    const other = index % 2 === 1
    const response = await endpoint.fetch(request('tools/call', { name: 'trackqa_list_projects', arguments: {} }, '2025-11-25', {
      'x-test-principal': other ? 'other' : 'first',
    }))
    assert.equal(response.headers.get('mcp-session-id'), null)
    const rpc = await decode(response)
    assert.equal(rpc.result.structuredContent.projects[0].id, other ? OTHER_PROJECT_ID : MOCK_PROJECT_ID)
    return rpc.result.structuredContent.projects[0].id
  }))
  assert.equal(projects.length, 20)
  assert.equal((await call(endpoint, 'trackqa_connection_status')).result.structuredContent.project_id, MOCK_PROJECT_ID)
})
