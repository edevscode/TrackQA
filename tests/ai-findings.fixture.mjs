import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createDatabaseEndpoint } from '../supabase/functions/trackqa-mcp/database-endpoint.ts'

// Reuses the disposable PGlite database and real migrations/RLS/triggers.
// Auth is the existing harness stub; there is no network or live credential.
export async function assertAiFindings(db, t) {
  const f = Object.fromEntries(['owner', 'qa', 'dev', 'outsider', 'otherOwner', 'project', 'otherProject'].map((key) => [key, randomUUID()]))
  async function as(role, user, action, claims = {}) {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role, sub: user, ...claims })])
    await db.exec(`set local role ${role}`)
    try { return await action() }
    finally { try { await db.exec('reset role') } catch { /* failed cases roll back below */ } }
  }
  const human = (user, action, claims) => as('authenticated', user, action, claims)
  const backend = (action) => as('service_role', null, action)
  async function denied(sql, args, code = '42501') {
    await db.exec('savepoint finding_denied')
    let actual
    try { await db.query(sql, args) } catch (error) { actual = error.code }
    finally { await db.exec('rollback to savepoint finding_denied; release savepoint finding_denied') }
    assert.equal(actual, code, 'expected SQLSTATE')
  }
  async function check(name, action) {
    await t.test(`AI findings SQL: ${name}`, async () => {
      await db.exec('savepoint finding_case')
      try { await action() }
      finally { await db.exec('rollback to savepoint finding_case; release savepoint finding_case; reset role') }
    })
  }
  const submitSql = 'select * from public.mcp_submit_finding($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)'
  const reviewSql = 'select * from public.review_ai_finding($1,$2,$3)'
  const payload = (changes = {}) => ({ hash: f.hash, project: f.project, key: randomUUID(), title: 'Synthetic potential bug', description: 'Synthetic reproduction details', severity: 'HIGH', file: 'src/example.ts', start: 12, end: 14, evidence: '<script>untrusted()</script>\nNever execute this text', ...changes })
  const args = (p) => [p.hash, p.project, p.key, p.title, p.description, p.severity, p.file, p.start, p.end, p.evidence]
  const submit = (p = payload()) => backend(async () => (await db.query(submitSql, args(p))).rows[0])
  const review = (id, decision, actor = f.qa) => human(actor, async () => (await db.query(reviewSql, [id, decision, 'Human review note'])).rows[0])
  const count = async (table) => (await db.query(`select count(*)::int as n from public.${table}`)).rows[0].n

  await db.exec('begin')
  try {
    for (const user of [f.owner, f.qa, f.dev, f.outsider, f.otherOwner]) await db.query('insert into auth.users(id,email) values($1,$2)', [user, `${user}@example.invalid`])
    for (const [project, owner, key] of [[f.project, f.owner, 'FINDINGS'], [f.otherProject, f.otherOwner, 'FINOTHER']]) {
      await db.query('insert into public.projects(id,name,key,owner_id) values($1,$2,$3,$4)', [project, 'Synthetic findings regression', key, owner])
      await db.query("insert into public.project_members(project_id,user_id,role) values($1,$2,'OWNER')", [project, owner])
    }
    await db.query("insert into public.project_members(project_id,user_id,role) values($1,$2,'QA'),($1,$3,'DEVELOPER')", [f.project, f.qa, f.dev])
    await human(f.owner, () => db.query('update public.projects set mcp_enabled=true where id=$1', [f.project]))
    const issued = await human(f.owner, () => db.query('select * from public.issue_mcp_connection_token($1,$2,$3)', [f.project, f.dev, 'Synthetic findings agent']))
    f.connection = issued.rows[0].connection_id
    f.hash = createHash('sha256').update(issued.rows[0].access_token).digest('hex')
    const baselineIssues = await count('issues')

    await check('actual MCP handler submits through real SQL, then human confirmation links one readable issue', async () => {
      // Only HTTP dispatch is substituted. Both RPCs execute as the real
      // backend role against this in-memory PostgreSQL database.
      const endpoint = createDatabaseEndpoint({ supabaseUrl: 'https://database.test', serviceRoleKey: 'synthetic-offline-only', allowedHostnames: ['mcp.test'],
        fetch: async (url, init) => {
          const operation = new URL(String(url)).pathname.split('/').at(-1)
          const value = JSON.parse(String(init.body))
          const result = await backend(async () => {
            if (operation === 'resolve_mcp_connection') return db.query('select * from public.resolve_mcp_connection($1)', [value.p_token_hash])
            if (operation === 'mcp_submit_finding') return db.query(submitSql, [value.p_token_hash, value.p_project_id, value.p_submission_id, value.p_title, value.p_description, value.p_severity, value.p_file_path, value.p_line_start, value.p_line_end, value.p_evidence_excerpt])
            if (operation === 'mcp_get_issue') return db.query('select * from public.mcp_get_issue($1,$2)', [value.p_token_hash, value.p_issue_id])
            throw new Error('Unexpected offline operation')
          })
          return Response.json(result.rows)
        },
      })
      async function tool(name, input) {
        const response = await endpoint.fetch(new Request('http://mcp.test/mcp', { method: 'POST', headers: {
          Host: 'mcp.test', Authorization: `Bearer ${issued.rows[0].access_token}`, Accept: 'application/json', 'Content-Type': 'application/json',
          'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': name,
        }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: input, _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': { name: 'offline-sql-integration', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {},
        } } }) }))
        assert.equal(response.status, 200)
        const rpc = await response.json()
        assert.equal(rpc.result?.isError, undefined, 'expected successful tool invocation')
        return rpc.result.structuredContent
      }
      const input = { project_id: f.project, submission_id: randomUUID(), title: 'End-to-end synthetic finding', description: 'In-memory only', severity: 'LOW', evidence_excerpt: '<untrusted>' }
      const submitted = (await tool('trackqa_submit_finding', input)).finding
      assert.equal(submitted.status, 'PENDING')
      assert.equal(await count('issues'), baselineIssues)
      assert.deepEqual((await tool('trackqa_submit_finding', input)).finding, submitted)
      const confirmed = await review(submitted.id, 'CONFIRMED')
      const issue = (await tool('trackqa_get_issue', { issue_id: confirmed.issue_id })).issue
      assert.equal(issue.title, input.title)
      assert.equal(issue.project_id, f.project)
      assert.equal(issue.status, 'OPEN')
      assert.equal(await count('issues'), baselineIssues + 1)
      assert.equal((await review(submitted.id, 'CONFIRMED')).issue_id, issue.id)
      assert.equal(await count('issues'), baselineIssues + 1)
    })

    await check('RPC argument names, output shapes, restricted grants and safe search paths', async () => {
      const contracts = [
        ['public.mcp_submit_finding(text,uuid,text,text,text,public.issue_priority,text,integer,integer,text)', 'service_role', ['p_token_hash', 'p_project_id', 'p_submission_id', 'p_title', 'p_description', 'p_severity', 'p_file_path', 'p_line_start', 'p_line_end', 'p_evidence_excerpt']],
        ['public.review_ai_finding(uuid,text,text)', 'authenticated', ['p_finding_id', 'p_decision', 'p_review_note']],
      ]
      for (const [signature, allowed, names] of contracts) {
        const row = (await db.query(`select prosecdef,proconfig,proargnames[1:pronargs] as args,
          exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute
          from pg_proc where oid=to_regprocedure($1)`, [signature])).rows[0]
        assert.equal(row.prosecdef, true)
        assert.equal(row.public_execute, false)
        assert.deepEqual(row.args, names)
        assert.deepEqual(row.proconfig, ['search_path=pg_catalog, public, pg_temp'])
        for (const role of ['anon', 'authenticated', 'service_role']) assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') ok", [role, signature])).rows[0].ok, role === allowed)
      }
      const receipt = await submit()
      assert.deepEqual(Object.keys(receipt).sort(), ['created_at', 'id', 'issue_id', 'project_id', 'status'])
    })
    await check('submission creates only a pending finding with database-derived provenance', async () => {
      const p = payload()
      const receipt = await submit(p)
      assert.equal(receipt.project_id, f.project)
      assert.equal(receipt.status, 'PENDING')
      assert.equal(receipt.issue_id, null)
      const row = (await db.query('select * from public.ai_findings where id=$1', [receipt.id])).rows[0]
      assert.equal(row.connection_id, f.connection)
      assert.equal(row.suggested_priority, p.severity)
      assert.equal(row.evidence_excerpt, p.evidence)
      for (const key of ['reviewed_by', 'reviewed_at', 'review_note', 'issue_id']) assert.equal(row[key], null)
      assert.equal(await count('issues'), baselineIssues)
    })
    await check('identical retries return one finding; changed content conflicts without overwrite', async () => {
      const p = payload()
      const first = await submit(p)
      assert.deepEqual(await submit(p), first)
      await backend(() => denied(submitSql, args({ ...p, evidence: 'Changed evidence' }), '22023'))
      assert.equal((await db.query('select count(*)::int as n from public.ai_findings where connection_id=$1 and submission_id=$2', [f.connection, p.key])).rows[0].n, 1)
      assert.equal((await db.query('select evidence_excerpt from public.ai_findings where id=$1', [first.id])).rows[0].evidence_excerpt, p.evidence)
    })
    for (const [name, change] of [
      ['blank title', { title: '  ' }], ['missing description', { description: null }],
      ['long description', { description: 'x'.repeat(8001) }], ['long title', { title: 'x'.repeat(241) }],
      ['missing key', { key: null }], ['long key', { key: 'x'.repeat(129) }],
      ['oversized evidence', { evidence: 'x'.repeat(4001) }], ['missing severity', { severity: null }],
      ['lines without path', { file: null }], ['end without start', { start: null }],
      ['reversed lines', { start: 14, end: 12 }], ['invalid line', { start: 0 }], ['empty path', { file: '' }],
    ]) await check(`input validation: ${name}`, () => backend(() => denied(submitSql, args(payload(change)), '22023')))
    await check('file and line range are optional', async () => {
      assert.equal((await submit(payload({ file: null, start: null, end: null, evidence: null }))).status, 'PENDING')
    })
    await check('cross-project and unknown token submission are denied', async () => {
      for (const change of [{ project: f.otherProject }, { hash: '0'.repeat(64) }, { hash: null }]) await backend(() => denied(submitSql, args(payload(change))))
    })
    for (const state of ['revoked', 'expired', 'removed membership', 'MCP disabled', 'archived']) {
      await check(`submission rechecks ${state}, including identical retries`, async () => {
        const p = payload()
        await submit(p)
        if (state === 'revoked') await human(f.owner, () => db.query('select public.revoke_mcp_connection($1)', [f.connection]))
        if (state === 'expired') await db.query("update public.mcp_connections set created_at=now()-interval '2 days', token_expires_at=now()-interval '1 day' where id=$1", [f.connection])
        if (state === 'removed membership') await human(f.owner, () => db.query('delete from public.project_members where project_id=$1 and user_id=$2', [f.project, f.dev]))
        if (state === 'MCP disabled') await human(f.owner, () => db.query('update public.projects set mcp_enabled=false where id=$1', [f.project]))
        if (state === 'archived') await db.query('update public.projects set archived=true where id=$1', [f.project])
        await backend(() => denied(submitSql, args(p)))
      })
    }
    await check('browsers cannot submit or directly alter provenance/review fields', async () => {
      const finding = await submit()
      for (const user of [f.owner, f.qa, f.dev]) await human(user, async () => {
        await denied(submitSql, args(payload()))
        await denied("update public.ai_findings set status='CONFIRMED',reviewed_by=$1,reviewed_at=now() where id=$2", [user, finding.id])
        await denied('delete from public.ai_findings where id=$1', [finding.id])
        await denied('insert into public.ai_findings(project_id,connection_id,submission_id,title,description) values($1,$2,$3,$4,$5)', [f.project, f.connection, 'direct', 'No', 'No'])
      })
    })
    await check('RLS exposes pending findings/evidence only to current project QA/Owner', async () => {
      const finding = await submit()
      for (const user of [f.qa, f.owner, f.dev, f.outsider, f.otherOwner]) await human(user, async () => {
        const result = await db.query('select evidence_excerpt from public.ai_findings where id=$1', [finding.id])
        assert.equal(result.rows.length, [f.qa, f.owner].includes(user) ? 1 : 0)
      })
    })
    for (const actor of ['qa', 'owner']) await check(`${actor} confirmation creates exactly one normal issue and records the human reviewer`, async () => {
      const p = payload()
      const finding = await submit(p)
      const confirmed = await review(finding.id, 'CONFIRMED', f[actor])
      assert.equal(confirmed.status, 'CONFIRMED')
      assert.ok(confirmed.issue_id)
      const issue = (await db.query('select * from public.issues where id=$1', [confirmed.issue_id])).rows[0]
      assert.equal(issue.reporter_id, f[actor])
      assert.equal(issue.status, 'OPEN')
      assert.equal(issue.priority, p.severity)
      assert.equal(issue.title, p.title)
      assert.equal(issue.assignee_id, null)
      assert.equal(issue.deadline_mode, 'none')
      assert.ok(issue.description.includes(p.evidence) && issue.description.includes('src/example.ts:12-14'))
      assert.equal((await db.query("select count(*)::int as n from public.issue_activity where issue_id=$1 and action='CREATED' and actor_id=$2", [issue.id, f[actor]])).rows[0].n, 1)
      const stored = (await db.query('select * from public.ai_findings where id=$1', [finding.id])).rows[0]
      assert.equal(stored.reviewed_by, f[actor])
      assert.ok(stored.reviewed_at)
      assert.equal(stored.review_note, 'Human review note')
      assert.equal(await count('issues'), baselineIssues + 1)
      assert.deepEqual(await review(finding.id, 'CONFIRMED', f[actor]), confirmed)
      assert.equal(await count('issues'), baselineIssues + 1)
      assert.equal((await submit(p)).issue_id, issue.id)
      await human(f[actor], () => denied(reviewSql, [finding.id, 'REJECTED', null], '22023'))
    })
    await check('rejection is terminal and creates no issue', async () => {
      const finding = await submit()
      const rejected = await review(finding.id, 'REJECTED')
      assert.equal(rejected.status, 'REJECTED')
      assert.equal(rejected.issue_id, null)
      assert.deepEqual(await review(finding.id, 'REJECTED', f.owner), rejected)
      assert.equal(await count('issues'), baselineIssues)
      await human(f.qa, () => denied(reviewSql, [finding.id, 'CONFIRMED', null], '22023'))
    })
    await check('deleted linked issue cannot be recreated by repeated confirmation', async () => {
      const finding = await submit()
      const confirmed = await review(finding.id, 'CONFIRMED')
      await human(f.owner, () => db.query('delete from public.issues where id=$1', [confirmed.issue_id]))
      const again = await review(finding.id, 'CONFIRMED')
      assert.equal(again.issue_id, null)
      assert.equal(again.status, 'CONFIRMED')
      assert.equal(await count('issues'), baselineIssues)
    })
    await check('review denies developers, outsiders, foreign Owners, backend and delegated claims', async () => {
      const finding = await submit()
      for (const user of [f.dev, f.outsider, f.otherOwner, null]) await human(user, () => denied(reviewSql, [finding.id, 'CONFIRMED', null]))
      await backend(() => denied(reviewSql, [finding.id, 'CONFIRMED', null]))
      await as('anon', null, () => denied(reviewSql, [finding.id, 'CONFIRMED', null]))
      await human(f.qa, () => denied(reviewSql, [finding.id, 'CONFIRMED', null]), { client_id: randomUUID() })
    })
    await check('review rechecks role changes and archive state', async () => {
      const finding = await submit()
      await human(f.owner, () => db.query("update public.project_members set role='DEVELOPER' where project_id=$1 and user_id=$2", [f.project, f.qa]))
      await human(f.qa, () => denied(reviewSql, [finding.id, 'CONFIRMED', null]))
      await db.query('update public.projects set archived=true where id=$1', [f.project])
      await human(f.owner, () => denied(reviewSql, [finding.id, 'CONFIRMED', null]))
    })
    await check('human review remains possible after connection revocation and MCP disablement', async () => {
      const finding = await submit()
      await human(f.owner, () => db.query('select public.revoke_mcp_connection($1)', [f.connection]))
      await human(f.owner, () => db.query('update public.projects set mcp_enabled=false where id=$1', [f.project]))
      assert.equal((await review(finding.id, 'CONFIRMED')).status, 'CONFIRMED')
    })
    await check('invalid reviews and failed issue creation leave the finding pending', async () => {
      const finding = await submit()
      for (const [decision, note] of [[null, null], ['PENDING', null], ['CONFIRMED', 'x'.repeat(4001)]]) await human(f.qa, () => denied(reviewSql, [finding.id, decision, note], '22023'))
      // Fault injection in this disposable DB only: verify transaction atomicity
      // when a normal issue trigger fails, not just the happy-path row count.
      await db.exec(`create function public.test_reject_issue() returns trigger language plpgsql as $$ begin raise exception 'synthetic failure'; end $$;
        create trigger z_test_reject before insert on public.issues for each row execute function public.test_reject_issue()`)
      await human(f.qa, () => denied(reviewSql, [finding.id, 'CONFIRMED', null], 'P0001'))
      assert.equal((await db.query('select status from public.ai_findings where id=$1', [finding.id])).rows[0].status, 'PENDING')
      assert.equal(await count('issues'), baselineIssues)
    })
  } finally { await db.exec('rollback; reset role') }
}
