import { createDatabaseEndpoint } from '../database-endpoint.ts'
import { MAX_DATABASE_RESPONSE_BYTES } from '../database-rpc.ts'
import type { RpcDiagnostic } from '../database-rpc.ts'
import { MAX_REQUEST_BYTES } from '../handler.ts'
import { MAX_TOOL_RESULT_BYTES } from '../tools.ts'
import { createMockDataAccess, MOCK_PROJECT_ID, OTHER_PROJECT_ID, MOCK_ISSUE_ID, OTHER_ISSUE_ID } from '../mock-data.ts'

// No external test dependencies. Only this test's HTTP client uses real fetch;
// its server binds to loopback and ALL database transport is mocked.
function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
  if (!condition) throw new Error(message)
}
const TOKEN_A = `tqm_${'a'.repeat(64)}`
const TOKEN_B = `tqm_${'b'.repeat(64)}`
const KEY = 'sb_secret_synthetic_key_only_for_deno_http_tests'
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
const HASH_A = await sha256(TOKEN_A)
const HASH_B = await sha256(TOKEN_B)
const rowA = { connection_id: '66666666-6666-4666-8666-666666666666', user_id: '77777777-7777-4777-8777-777777777777', project_id: MOCK_PROJECT_ID }
const rowB = { connection_id: '88888888-8888-4888-8888-888888888888', user_id: '99999999-9999-4999-8999-999999999999', project_id: OTHER_PROJECT_ID }
type Mode = 'normal' | 'deny_reads' | 'error' | 'oversize_transport' | 'oversize_field' | 'stall'
type Rpc = { result?: any; error?: any }

Deno.test('MCP handler over real Deno loopback HTTP with mocked database RPCs', async (t) => {
  let mode: Mode = 'normal'
  const diagnostics: Readonly<RpcDiagnostic>[] = []
  const calls: { operation: string; args: Record<string, any> }[] = []
  const data = createMockDataAccess()
  const endpoint = createDatabaseEndpoint({
    supabaseUrl: 'https://database.test', serviceRoleKey: KEY, timeoutMs: 200,
    allowedHostnames: ['127.0.0.1', 'edge-runtime.supabase.com'], diagnose: (event) => diagnostics.push(event),
    fetch: async (url, init) => {
      assert(String(url).startsWith('https://database.test/rest/v1/rpc/'), 'unexpected RPC destination')
      assert(new Headers(init?.headers).get('apikey') === KEY, 'server credential was replaced')
      assert(new Headers(init?.headers).get('Authorization') === null, 'modern backend key must not be sent as a JWT')
      assert(init?.redirect === 'error', 'redirect protection missing')
      const operation = String(url).split('/').at(-1)!
      const args = JSON.parse(String(init?.body))
      assert(!String(init?.body).includes(TOKEN_A) && !String(init?.body).includes(TOKEN_B), 'plaintext reached resolver')
      calls.push({ operation, args })
      const row = args.p_token_hash === HASH_A ? rowA : args.p_token_hash === HASH_B ? rowB : null
      if (!row) return Response.json([])
      if (operation === 'resolve_mcp_connection') return Response.json([row])
      if (mode === 'deny_reads') return Response.json([])
      if (mode === 'error') return Response.json({ details: `${KEY} ${HASH_A} internal SQL failure` }, { status: 500 })
      if (mode === 'oversize_transport') return new Response('x'.repeat(MAX_DATABASE_RESPONSE_BYTES + 1))
      if (mode === 'stall') return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('[')) } }))
      if (operation === 'mcp_submit_finding') return Response.json([{
        id: '88888888-8888-4888-8888-888888888888', project_id: row.project_id,
        status: 'PENDING', issue_id: null, created_at: '2026-11-01T00:00:00+00:00',
      }])
      if (operation === 'mcp_list_projects') {
        const project = await data.getProject(row.project_id)
        return Response.json(project ? [project] : [])
      }
      if (operation === 'mcp_list_issues') {
        const page = await data.listIssues(row.project_id, { limit: args.p_limit, offset: args.p_offset, status: args.p_status ?? undefined })
        return Response.json(page.issues)
      }
      if (operation === 'mcp_get_issue') {
        const issue = await data.getIssue(row.project_id, args.p_issue_id)
        if (!issue) return Response.json([])
        return Response.json([{ ...issue, ...(mode === 'oversize_field' ? { description: '界'.repeat(6000) } : {}) }])
      }
      throw new Error('Unexpected RPC')
    },
  })
  const observedHosts = new Set<string>()
  const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, request => {
    observedHosts.add(request.headers.get('host') ?? '')
    return endpoint.fetch(request)
  })
  const url = `http://127.0.0.1:${server.addr.port}/functions/v1/trackqa-mcp`
  // Deno fetch otherwise ignores custom Host values. This test client still
  // connects only to loopback; it does not relax the server's validation.
  const hostClient = Deno.createHttpClient({ allowHost: true })

  async function exchange(method: string, params: Record<string, unknown> = {}, token: string | null = TOKEN_A, version = '2026-07-28', host?: string) {
    const modern = version === '2026-07-28'
    return fetch(url, {
      client: hostClient,
      method: 'POST', headers: {
        Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json',
        'MCP-Protocol-Version': version,
        ...(modern ? { 'Mcp-Method': method, ...(typeof params.name === 'string' ? { 'Mcp-Name': params.name } : {}) } : {}),
        ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
        ...(host ? { Host: host } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: {
        ...params,
        ...(modern ? { _meta: {
          'io.modelcontextprotocol/protocolVersion': version,
          'io.modelcontextprotocol/clientInfo': { name: 'deno-http-test', version: '1' },
          'io.modelcontextprotocol/clientCapabilities': {},
        } } : {}),
      } }),
    })
  }
  async function body(response: Response): Promise<Rpc> {
    const text = await response.text()
    for (const value of [TOKEN_A, TOKEN_B, HASH_A, HASH_B, KEY]) assert(!text.includes(value), 'private credential leaked into HTTP output')
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      const messages = text.split('\n').filter((line) => line.startsWith('data: '))
      assert(messages.length === 1, 'unexpected legacy response framing')
      return JSON.parse(messages[0].slice(6))
    }
    return JSON.parse(text)
  }
  async function tool(name: string, args = {}, token = TOKEN_A, version = '2026-07-28') {
    const response = await exchange('tools/call', { name, arguments: args }, token, version)
    assert(response.status === 200, 'tool HTTP request failed')
    assert(response.headers.get('mcp-session-id') === null, 'unexpected persistent session')
    assert(response.headers.get('cache-control') === 'no-store', 'cache protection missing')
    return body(response)
  }
  function toolError(value: Rpc) {
    assert(value.error || value.result?.isError === true, 'expected tool failure')
    assert(value.result?.structuredContent === undefined, 'failure returned data')
    assert(new TextEncoder().encode(JSON.stringify(value)).byteLength < MAX_TOOL_RESULT_BYTES, 'error response too large')
  }

  try {
    await t.step('missing, empty, malformed and unknown bearer tokens return generic 401', async () => {
      for (const authorization of [undefined, 'Bearer', 'Bearer ', 'Basic synthetic', `Bearer ${HASH_A}`, `Bearer tqm_${'c'.repeat(64)}`]) {
        const response = await fetch(url, { method: 'POST', headers: authorization === undefined ? {} : { Authorization: authorization }, body: '{}' })
        assert(response.status === 401, 'invalid credentials accepted')
        assert(response.headers.get('www-authenticate') === 'Bearer realm="trackqa-mcp"', 'missing bearer challenge')
        assert((await response.json()).error === 'Authentication required.', 'unexpected authentication detail')
      }
      assert(calls.length === 1 && calls[0].operation === 'resolve_mcp_connection', 'malformed tokens reached database')
    })

    await t.step('Supabase internal Host preserves HTTP authentication, scoped reads and Host/Origin rejection', async () => {
      const before = calls.length
      for (const token of [null, 'malformed', `tqm_${'c'.repeat(64)}`]) {
        const response = await exchange('tools/list', {}, token, '2026-07-28', 'edge-runtime.supabase.com')
        assert(response.status === 401 && response.headers.get('www-authenticate') === 'Bearer realm="trackqa-mcp"', 'gateway Host did not reach custom challenge')
        assert(response.headers.get('cache-control') === 'no-store', 'gateway denial not cache protected')
        assert((await response.json()).error === 'Authentication required.', 'gateway denial disclosed details')
      }
      assert(calls.length === before + 1, 'missing/malformed tokens reached database')
      const authorized = await exchange('tools/call', { name: 'trackqa_list_projects', arguments: {} }, TOKEN_A, '2026-07-28', 'edge-runtime.supabase.com')
      assert(authorized.status === 200 && (await body(authorized)).result.structuredContent.projects[0].id === MOCK_PROJECT_ID, 'gateway scoped read failed')
      const afterRead = calls.length
      const rejected: Record<string, string>[] = [
        { Host: 'attacker.test', 'X-Forwarded-Host': 'edge-runtime.supabase.com' },
        { Host: 'edge-runtime.supabase.com.attacker.test' },
        { Host: 'edge-runtime.supabase.com', Origin: 'https://attacker.test' },
      ]
      for (const headers of rejected) {
        const response = await fetch(url, { client: hostClient, method: 'POST', headers: { ...headers, Authorization: `Bearer ${TOKEN_A}` }, body: '{}' })
        assert(response.status === 403, 'untrusted Host/Origin accepted through HTTP')
        await response.body?.cancel()
      }
      assert(calls.length === afterRead, 'untrusted Host/Origin reached database')
      assert(observedHosts.has('edge-runtime.supabase.com') && observedHosts.has('attacker.test'), 'HTTP client did not transmit the tested Host headers')
    })

    await t.step('legacy initialization and calls work for three protocol versions', async () => {
      for (const version of ['2025-03-26', '2025-06-18', '2025-11-25']) {
        const response = await exchange('initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'deno-http-test', version: '1' } }, TOKEN_A, version)
        assert(response.status === 200, 'initialization failed')
        assert((await body(response)).result.protocolVersion === version, 'wrong negotiated version')
        const result = (await tool('trackqa_list_projects', {}, TOKEN_A, version)).result
        assert(result.structuredContent.projects[0].id === MOCK_PROJECT_ID, 'legacy project scope incorrect')
      }
    })

    await t.step('current discovery exposes four read tools and one finding submission tool', async () => {
      const discovery = await exchange('server/discover')
      assert(discovery.status === 200 && (await body(discovery)).result.supportedVersions.includes('2026-07-28'), 'current discovery failed')
      const list = await exchange('tools/list')
      const tools = (await body(list)).result.tools
      assert(tools.length === 5 && tools.every((entry: any) => entry.annotations.readOnlyHint === (entry.name !== 'trackqa_submit_finding') && entry.inputSchema.additionalProperties === false), 'tool inventory/schema mismatch')
      const status = (await tool('trackqa_connection_status')).result.structuredContent
      assert(status.database_connected === true && status.data_source === 'database' && status.project_id === MOCK_PROJECT_ID, 'status failed')
      assert((await tool('trackqa_list_projects')).result.structuredContent.projects[0].id === MOCK_PROJECT_ID, 'project read failed')
      const page = (await tool('trackqa_list_issues', { project_id: MOCK_PROJECT_ID, limit: 1 })).result.structuredContent
      assert(page.issues.length === 1 && page.next_offset === 1, 'issue pagination failed')
      const detail = (await tool('trackqa_get_issue', { issue_id: MOCK_ISSUE_ID })).result.structuredContent.issue
      assert(detail.id === MOCK_ISSUE_ID && detail.description.length > 0, 'issue detail failed')
    })

    await t.step('finding submission uses verified scope and returns only a pending receipt', async () => {
      const input = { project_id: MOCK_PROJECT_ID, submission_id: 'deno-synthetic-retry', title: 'Potential bug', description: 'Synthetic only', severity: 'LOW', file_path: 'src/example.ts', line_start: 1, evidence_excerpt: '<untrusted evidence>' }
      const result = (await tool('trackqa_submit_finding', input)).result
      assert(result.structuredContent.finding.status === 'PENDING', 'submission failed')
      assert(!JSON.stringify(result).includes(input.evidence_excerpt), 'evidence must not be echoed in the receipt')
      assert(calls.at(-1)?.operation === 'mcp_submit_finding' && calls.at(-1)?.args.p_token_hash === HASH_A, 'private hash missing')
      assert((await tool('trackqa_submit_finding', { ...input, project_id: OTHER_PROJECT_ID })).result.isError, 'foreign project accepted')
      mode = 'deny_reads'
      assert((await tool('trackqa_submit_finding', input)).result.isError, 'submission must fail closed after eligibility changes')
      mode = 'normal'
    })

    await t.step('initialization does not bypass authentication on later requests', async () => {
      const response = await exchange('tools/list', {}, null)
      assert(response.status === 401, 'session unexpectedly bypassed bearer verification')
      await response.body?.cancel()
    })

    await t.step('strict inputs and cross-project access fail without returning issue data', async () => {
      for (const [name, args] of [
        ['trackqa_connection_status', { user_id: rowB.user_id }],
        ['trackqa_get_issue', { issue_id: 'invalid' }],
        ['trackqa_get_issue', { issue_id: OTHER_ISSUE_ID }],
        ['trackqa_list_issues', { project_id: OTHER_PROJECT_ID }],
        ['trackqa_list_issues', { project_id: MOCK_PROJECT_ID, limit: 51 }],
      ] as const) toolError(await tool(name, args))
    })

    await t.step('eligibility lost between verification and read cannot return a healthy status or data', async () => {
      mode = 'deny_reads'
      try {
        toolError(await tool('trackqa_connection_status'))
        assert((await tool('trackqa_list_projects')).result.structuredContent.projects.length === 0, 'ineligible project exposed')
        toolError(await tool('trackqa_get_issue', { issue_id: MOCK_ISSUE_ID }))
      } finally { mode = 'normal' }
    })

    await t.step('HTTP request byte limit and malformed JSON are rejected', async () => {
      const oversized = await exchange('tools/call', { name: 'trackqa_get_issue', arguments: { issue_id: 'x'.repeat(MAX_REQUEST_BYTES) } })
      assert(oversized.status === 413, 'oversized HTTP body accepted')
      await body(oversized)
      const malformed = await fetch(url, { method: 'POST', headers: {
        Authorization: `Bearer ${TOKEN_A}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json',
      }, body: '{' })
      assert(malformed.status >= 400, 'malformed JSON accepted')
      await body(malformed)
    })

    await t.step('database response and oversized text limits produce bounded tool errors', async () => {
      for (const next of ['oversize_transport', 'oversize_field'] as const) {
        mode = next
        try { toolError(await tool('trackqa_get_issue', { issue_id: MOCK_ISSUE_ID })) }
        finally { mode = 'normal' }
      }
      assert(diagnostics.some((event) => event.code === 'response_limit'), 'missing bounded transport diagnostic')
    })

    await t.step('database failures reveal no credentials or internal errors over HTTP or diagnostics', async () => {
      mode = 'error'
      try {
        const result = await tool('trackqa_list_projects')
        toolError(result)
        assert(result.result.content[0].text === 'Data unavailable or access denied.', 'raw database error exposed')
        const event = diagnostics.at(-1)!
        assert(event.operation === 'mcp_list_projects' && event.code === 'http' && event.status === 500, 'unsafe or missing diagnostic')
        const serialized = JSON.stringify(diagnostics)
        for (const value of [TOKEN_A, HASH_A, KEY, 'internal SQL failure']) assert(!serialized.includes(value), 'private diagnostic data exposed')
      } finally { mode = 'normal' }
    })

    await t.step('stalled mocked database bodies time out safely', async () => {
      mode = 'stall'
      try { toolError(await tool('trackqa_get_issue', { issue_id: MOCK_ISSUE_ID })) }
      finally { mode = 'normal' }
      assert(diagnostics.at(-1)?.code === 'timeout', 'stalled body did not time out')
    })

    await t.step('unapproved browser Origin and unsupported HTTP methods are rejected', async () => {
      const origin = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN_A}`, Origin: 'https://evil.test' }, body: '{}' })
      assert(origin.status === 403, 'unapproved Origin accepted')
      await origin.body?.cancel()
      for (const method of ['GET', 'DELETE']) {
        const response = await fetch(url, { method, headers: { Authorization: `Bearer ${TOKEN_A}`, Accept: 'text/event-stream' } })
        assert(response.status === 405, 'unsupported HTTP method accepted')
        await response.body?.cancel()
      }
    })

    await t.step('concurrent HTTP connections preserve private token/project isolation', async () => {
      await Promise.all(Array.from({ length: 12 }, async (_, index) => {
        const a = index % 2 === 0
        const result = await tool('trackqa_list_projects', {}, a ? TOKEN_A : TOKEN_B)
        assert(result.result.structuredContent.projects[0].id === (a ? MOCK_PROJECT_ID : OTHER_PROJECT_ID), 'concurrent identity crossed projects')
      }))
    })

    if ((await Deno.permissions.query({ name: 'env', variable: 'TRACKQA_CODEX_EXE' })).state === 'granted') {
      await t.step('installed Codex initializes, discovers four tools and lists the authorized synthetic issue', async () => {
        const module = new URL('../../../../tools/mcp-pilot/codex-client.mjs', import.meta.url).href
        const code = `import { checkCodexMcp } from ${JSON.stringify(module)};
          const result = await checkCodexMcp({ executable: ${JSON.stringify(Deno.env.get('TRACKQA_CODEX_EXE'))},
            cwd: ${JSON.stringify(new URL('../../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))},
            token: ${JSON.stringify(TOKEN_A)}, endpoint: ${JSON.stringify(url)},
            projectId: ${JSON.stringify(MOCK_PROJECT_ID)}, issueId: ${JSON.stringify(MOCK_ISSUE_ID)}, onlyListIssues: true });
          console.log(JSON.stringify(result));`
        const output = await new Deno.Command(Deno.env.get('TRACKQA_NODE_EXE')!, {
          args: ['--input-type=module', '-e', code], stdout: 'piped', stderr: 'piped',
        }).output()
        const result = JSON.parse(new TextDecoder().decode(output.stdout))
        assert(output.success && result.ok, 'Native Codex result: ' + JSON.stringify(result))
        assert(result.checks.length === 2, 'expected discovery and one read-only invocation')
        assert(result.checks[1].check === 'trackqa_list_issues', 'unexpected native Codex tool')
      })
    }
  } finally {
    hostClient.close()
    await server.shutdown()
    await server.finished
  }
})
