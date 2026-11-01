// Import the source or deployment entry without opening a listener, reading real
// environment values, or permitting database/network access. No 0034 RPC exists.
export async function checkEntryPoint(load: () => Promise<unknown>) {
  const originalServe = Object.getOwnPropertyDescriptor(Deno, 'serve')!
  const originalGet = Object.getOwnPropertyDescriptor(Deno.env, 'get')!
  const originalFetch = globalThis.fetch
  let handler: ((request: Request) => Promise<Response>) | undefined
  const calls: string[] = []
  const callCount = () => calls.length
  let mode = 'invalid'
  const token = `tqm_${'a'.repeat(64)}`
  const key = 'synthetic-entrypoint-server-key'
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))),
    byte => byte.toString(16).padStart(2, '0')).join('')
  const project = { id: '11111111-1111-4111-8111-111111111111', name: 'Synthetic project', key: 'SYN' }
  const issue = { id: '44444444-4444-4444-8444-444444444444', project_id: project.id,
    issue_number: 1, title: 'Synthetic issue', status: 'OPEN', priority: 'LOW', description: 'Synthetic description' }
  function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
  const request = (method: string, params: Record<string, unknown> = {}, credential: string | undefined = `Bearer ${token}`) =>
    new Request('https://database.test/functions/v1/trackqa-mcp', {
      method: 'POST', headers: { Host: 'edge-runtime.supabase.com', ...(credential ? { Authorization: credential } : {}),
        Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2025-11-25' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
  try {
    Object.defineProperty(Deno, 'serve', { configurable: true, value: (fetch: typeof handler) => { handler = fetch } })
    Object.defineProperty(Deno.env, 'get', { configurable: true, value: (name: string) => {
      if (name === 'SUPABASE_URL') return 'https://database.test'
      if (name === 'SUPABASE_SERVICE_ROLE_KEY') return key
      return undefined
    } })
    globalThis.fetch = async (input, init) => {
      const operation = String(input).slice('https://database.test/rest/v1/rpc/'.length)
      assert(String(input) === `https://database.test/rest/v1/rpc/${operation}`
        && new Headers(init?.headers).get('Authorization') === `Bearer ${key}`, 'Unexpected database destination or credential')
      assert(['resolve_mcp_connection', 'mcp_list_projects', 'mcp_list_issues', 'mcp_get_issue'].includes(operation),
        'Unexpected RPC: pilot must work without 0034')
      const args = JSON.parse(String(init?.body))
      assert(args.p_token_hash === hash && !String(init?.body).includes(token), 'Wrong hash or plaintext sent to database')
      calls.push(operation)
      if (mode === 'unavailable') return Response.json({ details: 'synthetic internal detail' }, { status: 503 })
      if (operation === 'resolve_mcp_connection') return Response.json(['allow', 'read_disabled'].includes(mode)
        ? [{ connection_id: '22222222-2222-4222-8222-222222222222',
          user_id: '33333333-3333-4333-8333-333333333333', project_id: project.id }] : [])
      if (mode === 'read_disabled') return Response.json([])
      if (operation === 'mcp_list_projects') return Response.json([project])
      if (operation === 'mcp_list_issues') {
        const { description: _description, ...summary } = issue
        return Response.json([summary])
      }
      return Response.json([issue])
    }
    await load()
    assert(handler, 'Entry point did not register its HTTP handler')
    const rejectedHeaders: Record<string, string>[] = [
      { Host: 'attacker.test' }, { Host: 'edge-runtime.supabase.com.attacker.test' },
      { Host: 'attacker@edge-runtime.supabase.com' }, { Host: 'edge-runtime.supabase.com/path' },
      { Host: 'attacker.test', 'X-Forwarded-Host': 'edge-runtime.supabase.com', Forwarded: 'host=edge-runtime.supabase.com' },
      { Host: 'edge-runtime.supabase.com', Origin: 'https://attacker.test' },
      { Host: 'edge-runtime.supabase.com', Origin: 'https://edge-runtime.supabase.com' },
      { Host: 'database.test', Origin: 'https://attacker.test' },
    ]
    for (const headers of rejectedHeaders) {
      const req = request('tools/list')
      for (const [name, value] of Object.entries(headers)) req.headers.set(name, value)
      const response = await handler(req)
      assert(response.status === 403 && calls.length === 0, 'Rejected Host/Origin reached database')
      await response.body?.cancel()
    }
    const missingHost = request('tools/list')
    missingHost.headers.delete('Host')
    const missingHostResponse = await handler(missingHost)
    assert(missingHostResponse.status === 403 && callCount() === 0, 'Missing Host reached database')
    await missingHostResponse.body?.cancel()
    for (const host of ['database.test', 'edge-runtime.supabase.com']) {
      for (const credential of ['', 'Bearer malformed', `Bearer ${token}`]) {
        const req = request('tools/list', {}, credential)
        req.headers.set('Host', host)
        const response = await handler(req)
        assert(response.status === 401 && response.headers.get('Cache-Control') === 'no-store'
          && response.headers.get('WWW-Authenticate') === 'Bearer realm="trackqa-mcp"', 'Trusted Host did not reach custom authentication')
        await response.body?.cancel()
      }
    }
    const forgedForwarding = request('tools/list', {}, '')
    forgedForwarding.headers.set('X-Forwarded-Host', 'attacker.test')
    const forwardedResponse = await handler(forgedForwarding)
    assert(forwardedResponse.status === 401, 'Forwarded Host affected the actual trusted Host')
    await forwardedResponse.body?.cancel()
    assert(callCount() === 2 && calls.every(operation => operation === 'resolve_mcp_connection'), 'Cheap denial bypassed or resolver not called')
    for (const denied of ['expired', 'revoked', 'disabled', 'removed_member', 'archived', 'unavailable']) {
      mode = denied
      const count: number = calls.length
      const response = await handler(request('tools/call', { name: 'trackqa_list_projects', arguments: {} }))
      assert(response.status === 401 && calls.length === count + 1, 'Ineligible connection not denied')
      const body = await response.text()
      assert(!body.includes(key) && !body.includes(hash) && !body.includes('synthetic internal detail'), 'Denial leaked details')
    }
    const tools: [string, Record<string, unknown>][] = [
      ['trackqa_connection_status', {}], ['trackqa_list_projects', {}],
      ['trackqa_list_issues', { project_id: project.id }], ['trackqa_get_issue', { issue_id: issue.id }],
    ]
    // All MCP entry methods and tools deny before data access when the resolver
    // reports projects disabled. The SQL regression separately tests real flags.
    mode = 'disabled'
    const deniedMethods: [string, Record<string, unknown>][] = [['initialize', {}], ['tools/list', {}],
      ...tools.map(([name, arguments_]): [string, Record<string, unknown>] => ['tools/call', { name, arguments: arguments_ }])]
    for (const [method, params] of deniedMethods) {
      const count: number = calls.length
      const response = await handler(request(method, params))
      assert(response.status === 401 && calls.length === count + 1 && calls.at(-1) === 'resolve_mcp_connection',
        'Disabled project reached MCP data or discovery')
      await response.body?.cancel()
    }
    async function exchange(method: string, params: Record<string, unknown>) {
      const response = await handler!(request(method, params))
      const text = await response.text()
      assert(response.status === 200 && response.headers.get('Cache-Control') === 'no-store', 'Authorized exchange failed')
      assert(![key, token, hash].some(secret => text.includes(secret)), 'Credential leaked into MCP response')
      return JSON.parse(response.headers.get('content-type')?.includes('text/event-stream')
        ? text.split('\n').find(line => line.startsWith('data: '))!.slice(6) : text)
    }
    mode = 'allow'
    assert((await exchange('initialize', { protocolVersion: '2025-11-25', capabilities: {},
      clientInfo: { name: 'entry-test', version: '1' } })).result.protocolVersion === '2025-11-25', 'Initialization failed')
    const inventory = (await exchange('tools/list', {})).result.tools
    assert(inventory.length === 4 && tools.every(([name]) => inventory.some((tool: { name: string }) => tool.name === name)), 'Wrong tool inventory')
    for (const [name, arguments_] of tools) {
      const value = (await exchange('tools/call', { name, arguments: arguments_ })).result
      assert(!value.isError && value.structuredContent, 'Authorized read tool failed')
      if (name === 'trackqa_connection_status') assert(value.structuredContent.database_connected === true, 'Status failed')
      if (name === 'trackqa_list_projects') assert(value.structuredContent.projects[0].id === project.id, 'Project scope failed')
      if (name === 'trackqa_list_issues') assert(value.structuredContent.issues[0].id === issue.id, 'Issue listing failed')
      if (name === 'trackqa_get_issue') assert(value.structuredContent.issue.id === issue.id, 'Issue detail failed')
    }
    mode = 'read_disabled'
    const status = (await exchange('tools/call', { name: 'trackqa_connection_status', arguments: {} })).result
    assert(status.isError === true && !status.structuredContent, 'Disable between resolver and read returned a healthy status')
  } finally {
    Object.defineProperty(Deno, 'serve', originalServe)
    Object.defineProperty(Deno.env, 'get', originalGet)
    globalThis.fetch = originalFetch
  }
}
