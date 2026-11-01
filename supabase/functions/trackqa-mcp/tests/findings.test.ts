import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { createDatabaseEndpoint } from '../database-endpoint.ts'
import { MOCK_PROJECT_ID, OTHER_PROJECT_ID } from '../mock-data.ts'

const token = `tqm_${'a'.repeat(64)}`
const hash = createHash('sha256').update(token).digest('hex')
const key = 'sb_secret_synthetic_findings_test_key_only'
const identity = { connection_id: '66666666-6666-4666-8666-666666666666', user_id: '77777777-7777-4777-8777-777777777777', project_id: MOCK_PROJECT_ID }
const input = { project_id: MOCK_PROJECT_ID, submission_id: 'synthetic-stable-key', title: 'Potential bug', description: 'Synthetic reproduction', severity: 'HIGH', file_path: 'src/example.ts', line_start: 1, line_end: 2, evidence_excerpt: '<script>untrusted text</script>' }
const receipt = { id: '88888888-8888-4888-8888-888888888888', project_id: MOCK_PROJECT_ID, status: 'PENDING', issue_id: null, created_at: '2026-11-01T00:00:00+00:00' }

function harness() {
  const calls: { operation: string; args: Record<string, unknown> }[] = []
  const state = { resolverAllowed: true, submissionAllowed: true, response: [receipt] as unknown, error: false }
  const diagnostics: unknown[] = []
  const endpoint = createDatabaseEndpoint({ supabaseUrl: 'https://database.test', serviceRoleKey: key, allowedHostnames: ['mcp.test'], diagnose: (event) => diagnostics.push(event),
    fetch: async (url, init) => {
      const operation = String(url).split('/').at(-1)!
      const args = JSON.parse(String(init?.body))
      calls.push({ operation, args })
      assert.equal(new Headers(init?.headers).get('apikey'), key)
      assert.equal(new Headers(init?.headers).get('Authorization'), null)
      if (operation === 'resolve_mcp_connection' && args.p_token_hash !== hash) return Response.json([])
      assert.equal(args.p_token_hash, hash)
      assert.ok(!String(init?.body).includes(token))
      if (operation === 'resolve_mcp_connection') return Response.json(state.resolverAllowed ? [identity] : [])
      assert.equal(operation, 'mcp_submit_finding')
      if (state.error) return Response.json({ message: `${key} ${hash} internal database details` }, { status: 400 })
      return Response.json(state.submissionAllowed ? state.response : [])
    },
  })
  async function call(args: unknown = input, auth: string | null = `Bearer ${token}`) {
    const response = await endpoint.fetch(new Request('http://mcp.test/mcp', {
      method: 'POST', headers: { Host: 'mcp.test', 'Content-Type': 'application/json', Accept: 'application/json',
        'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': 'trackqa_submit_finding', ...(auth === null ? {} : { Authorization: auth }) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'trackqa_submit_finding', arguments: args, _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': { name: 'synthetic-test', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {},
      } } }),
    }))
    const text = await response.text()
    for (const secret of [token, hash, key, 'internal database details']) assert.ok(!text.includes(secret), 'response exposed private data')
    return { status: response.status, rpc: JSON.parse(text) }
  }
  return { call, state, calls, diagnostics }
}

test('fifth tool uses private verified hash and exact SQL submission arguments; reply excludes evidence', async () => {
  const h = harness()
  const result = await h.call()
  assert.equal(result.status, 200)
  assert.deepEqual(result.rpc.result.structuredContent.finding, receipt)
  assert.equal(JSON.stringify(result.rpc).includes(input.evidence_excerpt), false)
  assert.deepEqual(h.calls[1], { operation: 'mcp_submit_finding', args: {
    p_token_hash: hash, p_project_id: MOCK_PROJECT_ID, p_submission_id: input.submission_id,
    p_title: input.title, p_description: input.description, p_severity: input.severity,
    p_file_path: input.file_path, p_line_start: input.line_start, p_line_end: input.line_end, p_evidence_excerpt: input.evidence_excerpt,
  } })
})

test('identical retries preserve submission ID and payload; reviewed receipts are accepted', async () => {
  const h = harness()
  await h.call()
  await h.call()
  assert.deepEqual(h.calls[1], h.calls[3])
  h.state.response = [{ ...receipt, status: 'CONFIRMED', issue_id: '99999999-9999-4999-8999-999999999999' }]
  assert.equal((await h.call()).rpc.result.structuredContent.finding.status, 'CONFIRMED')
})

test('omitted location and evidence are sent as SQL nulls', async () => {
  const h = harness()
  await h.call({ project_id: MOCK_PROJECT_ID, submission_id: 'no-location', title: 'Potential bug', description: 'Synthetic', severity: 'LOW' })
  for (const name of ['p_file_path', 'p_line_start', 'p_line_end', 'p_evidence_excerpt']) assert.equal(h.calls[1].args[name], null)
})

test('client project cannot override verified connection scope', async () => {
  const h = harness()
  const result = await h.call({ ...input, project_id: OTHER_PROJECT_ID })
  assert.equal(result.rpc.result.isError, true)
  assert.deepEqual(h.calls.map((call) => call.operation), ['resolve_mcp_connection'])
})

for (const changes of [
  { title: '' }, { title: '   ' }, { description: '' }, { description: 'x'.repeat(8001) },
  { severity: 'URGENT' }, { submission_id: '' }, { submission_id: 'x'.repeat(129) },
  { file_path: '' }, { file_path: 'x'.repeat(1025) }, { line_start: 0 }, { line_start: 4, line_end: 2 },
  { line_start: undefined, line_end: 2 }, { file_path: undefined }, { evidence_excerpt: 'x'.repeat(4001) },
  { reviewed_by: identity.user_id }, { status: 'CONFIRMED' }, { token_hash: 'not-a-token' },
]) test(`finding input validation rejects ${Object.keys(changes).join('/')}`, async () => {
  const h = harness()
  const result = await h.call({ ...input, ...changes })
  assert.ok(result.rpc.error || result.rpc.result?.isError)
  assert.equal(h.calls.length, 1, 'invalid input must not reach submission RPC')
})

test('submission requires valid bearer authentication before any tool or submission RPC', async () => {
  for (const auth of [null, 'Bearer invalid', `Bearer tqm_${'b'.repeat(64)}`]) {
    const h = harness()
    h.state.resolverAllowed = false
    const response = await h.call(input, auth)
    assert.equal(response.status, 401)
    assert.ok(h.calls.every((call) => call.operation === 'resolve_mcp_connection'))
  }
})

for (const reason of ['revocation', 'expiry', 'removed membership', 'disabled MCP', 'archived project']) test(`RPC denial after authentication (${reason}) fails closed`, async () => {
  const h = harness()
  // The database independently rechecks eligibility after the initial resolver;
  // the real state transitions are also tested against PGlite, not mocked here.
  h.state.submissionAllowed = false
  const response = await h.call()
  assert.equal(response.rpc.result.isError, true)
  assert.equal(response.rpc.result.structuredContent, undefined)
})

test('database errors and malformed/cross-project/oversized receipts are safely denied', async () => {
  for (const response of [[{ ...receipt, project_id: OTHER_PROJECT_ID }], [{ ...receipt, unexpected: 'private' }], [], [receipt, receipt], [{ ...receipt, status: 'OPEN' }], [{ ...receipt, id: 'x'.repeat(70_000) }]]) {
    const h = harness()
    h.state.response = response
    assert.equal((await h.call()).rpc.result.isError, true)
  }
  const h = harness()
  h.state.error = true
  assert.equal((await h.call()).rpc.result.isError, true)
  assert.deepEqual(h.diagnostics, [{ operation: 'mcp_submit_finding', code: 'http', status: 400 }])
})
