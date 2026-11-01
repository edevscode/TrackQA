import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'

// Called only by the existing disposable, in-memory PGlite harness. No clients,
// URLs, environment credentials, files/databases to persist, or network calls.
// Auth JWT claims are test stubs; role ACLs, RLS and RPC bodies are real SQL.
export async function assertMcpPermissions(db, t) {
  const f = Object.fromEntries(['owner', 'qa', 'dev', 'member', 'outsider', 'otherOwner', 'project', 'otherProject'].map((name) => [name, randomUUID()]))
  const hash = (token) => createHash('sha256').update(token).digest('hex')
  const signatures = [
    ['public.issue_mcp_connection_token(uuid,uuid,text)', ['p_project_id', 'p_user_id', 'p_client_label'], 'authenticated'],
    ['public.revoke_mcp_connection(uuid)', ['p_connection_id'], 'authenticated'],
    ['public.resolve_mcp_connection(text)', ['p_token_hash'], 'service_role'],
    ['public.mcp_list_projects(text)', ['p_token_hash'], 'service_role'],
    ['public.mcp_list_issues(text,integer,integer,public.issue_status)', ['p_token_hash', 'p_limit', 'p_offset', 'p_status'], 'service_role'],
    ['public.mcp_get_issue(text,uuid)', ['p_token_hash', 'p_issue_id'], 'service_role'],
  ]

  async function asRole(role, user, action, extra = {}) {
    assert.ok(['authenticated', 'anon', 'service_role', 'mcp_test_public'].includes(role))
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ ...(user ? { sub: user } : {}), role, ...extra })])
    await db.exec(`set local role ${role}`)
    try { return await action() }
    finally {
      // Preserve the original failure if a SQL exception aborted this case.
      try { await db.exec("reset role; select set_config('request.jwt.claims','{}',true)") } catch { /* case rollback below */ }
    }
  }
  const human = (user, action, extra) => asRole('authenticated', user, action, extra)
  const backend = (action) => asRole('service_role', null, action)
  async function denied(statement, params = [], expected = '42501') {
    await db.exec('savepoint mcp_denied')
    let code
    try { await db.query(statement, params) } catch (error) { code = error.code }
    finally { await db.exec('rollback to savepoint mcp_denied; release savepoint mcp_denied') }
    // Avoid printing SQL parameters, credential results or full database errors.
    assert.equal(code, expected, 'expected PostgreSQL denial SQLSTATE')
  }
  async function check(name, action) {
    await t.test(`MCP SQL: ${name}`, async () => {
      await db.exec('savepoint mcp_case')
      try { await action() }
      finally { await db.exec('rollback to savepoint mcp_case; release savepoint mcp_case; reset role') }
    })
  }
  async function issue(user, project, member, label) {
    return human(user, async () => {
      const result = await db.query('select * from public.issue_mcp_connection_token(p_project_id => $1, p_user_id => $2, p_client_label => $3)', [project, member, label])
      assert.equal(result.rows.length, 1)
      assert.deepEqual(Object.keys(result.rows[0]).sort(), ['access_token', 'connection_id'])
      assert.equal(/^tqm_[0-9a-f]{64}$/.test(result.rows[0].access_token), true, 'token has the specified CSPRNG encoding')
      return { id: result.rows[0].connection_id, hash: hash(result.rows[0].access_token) }
    })
  }
  async function noAccess(tokenHash) {
    await backend(async () => {
      for (const [query, args] of [
        ['select * from public.resolve_mcp_connection($1)', [tokenHash]],
        ['select * from public.mcp_list_projects($1)', [tokenHash]],
        ['select * from public.mcp_list_issues($1)', [tokenHash]],
        ['select * from public.mcp_get_issue($1,$2)', [tokenHash, f.issue]],
      ]) assert.equal((await db.query(query, args)).rows.length, 0, 'ineligible connection returned data')
    })
  }

  await db.exec('begin')
  try {
    await db.exec('create role mcp_test_public nologin')
    for (const user of [f.owner, f.qa, f.dev, f.member, f.outsider, f.otherOwner]) {
      await db.query('insert into auth.users(id,email) values($1,$2)', [user, `${user}@example.invalid`])
    }
    for (const [project, owner, key] of [[f.project, f.owner, 'MCPTESTA'], [f.otherProject, f.otherOwner, 'MCPTESTB']]) {
      await db.query('insert into public.projects(id,name,key,owner_id) values($1,$2,$3,$4)', [project, 'Synthetic MCP regression', key, owner])
      await db.query("insert into public.project_members(project_id,user_id,role) values($1,$2,'OWNER'),($1,$3,'QA'),($1,$4,'DEVELOPER')", [project, owner, f.qa, f.member])
    }
    await db.query("insert into public.project_members(project_id,user_id,role) values($1,$2,'DEVELOPER')", [f.project, f.dev])
    await check('MCP defaults off and cannot issue before Owner enablement', async () => {
      assert.equal((await db.query('select mcp_enabled from public.projects where id=$1', [f.project])).rows[0].mcp_enabled, false)
      await human(f.owner, () => denied('select * from public.issue_mcp_connection_token($1,$2,$3)', [f.project, f.member, 'Disabled']))
    })
    await human(f.owner, () => db.query('update public.projects set mcp_enabled=true where id=$1', [f.project]))
    await human(f.otherOwner, () => db.query('update public.projects set mcp_enabled=true where id=$1', [f.otherProject]))
    // Exercise the actual QA issue-creation triggers; the linked MCP member has
    // no assigned/reported work, so membership-removal tests can use normal RLS.
    const created = await human(f.qa, () => db.query(`
      insert into public.issues(project_id,title,description,assignee_id)
      select $1, 'Synthetic issue ' || n::text,
        case when n=1 then 'Synthetic details' else null end, $2::uuid
      from generate_series(1,55) n returning id,issue_number`, [f.project, f.dev]))
    f.issue = created.rows.find((row) => row.issue_number === 1).id
    f.nullDescriptionIssue = created.rows.find((row) => row.issue_number === 2).id
    f.otherIssue = (await human(f.qa, () => db.query('insert into public.issues(project_id,title) values($1,$2) returning id', [f.otherProject, 'Foreign synthetic issue']))).rows[0].id
    const a = await issue(f.owner, f.project, f.member, 'Synthetic IDE A')
    const second = await issue(f.owner, f.project, f.member, 'Synthetic IDE B')
    const other = await issue(f.otherOwner, f.otherProject, f.member, 'Synthetic foreign project')

    await check('Owner issuance stores only distinct hashes, correct principals and finite expiry', async () => {
      assert.equal(a.hash !== second.hash, true, 'independent issuance must produce independent credentials')
      const row = (await db.query(`select user_id,project_id,approved_by,token_hash,revoked_at,
        token_expires_at > statement_timestamp() as future_expiry,
        token_expires_at = created_at + interval '90 days' as default_expiry
        from public.mcp_connections where id=$1`, [a.id])).rows[0]
      assert.equal(row.user_id, f.member)
      assert.equal(row.project_id, f.project)
      assert.equal(row.approved_by, f.owner)
      assert.equal(row.token_hash === a.hash, true, 'stored hash must match SHA-256 of complete returned token')
      assert.equal(row.revoked_at, null)
      assert.equal(row.future_expiry && row.default_expiry, true)
      const columns = (await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='mcp_connections'")).rows.map((row) => row.column_name)
      assert.equal(columns.some((column) => /^(access_token|plaintext_token|token_secret|refresh_token)$/.test(column)), false)
    })

    await check('function signatures, definer search paths and effective ACLs match the RPC contract', async () => {
      for (const [signature, args, allowed] of signatures) {
        const info = (await db.query(`select p.proargnames[1:p.pronargs] as args,p.prosecdef,p.proconfig,
          exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
            where acl.grantee=0 and acl.privilege_type='EXECUTE') as public_execute
          from pg_proc p where p.oid=to_regprocedure($1)`, [signature])).rows[0]
        assert.ok(info, 'RPC signature must resolve')
        assert.deepEqual(info.args, args)
        assert.equal(info.prosecdef, true)
        assert.equal(info.public_execute, false)
        assert.ok(info.proconfig.some((setting) => setting.startsWith('search_path=pg_catalog, public,') && setting.endsWith('pg_temp')))
        for (const role of ['anon', 'authenticated', 'service_role', 'mcp_test_public']) {
          assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') as allowed", [role, signature])).rows[0].allowed, role === allowed)
        }
      }
    })

    await check('anon, authenticated Owners and PUBLIC-only roles cannot execute backend RPCs', async () => {
      for (const role of ['anon', 'authenticated', 'mcp_test_public']) {
        await asRole(role, f.owner, async () => {
          assert.equal((await db.query('select current_user as actor')).rows[0].actor, role)
          for (const [query, args] of [
            ['select * from public.resolve_mcp_connection($1)', [a.hash]],
            ['select * from public.mcp_list_projects($1)', [a.hash]],
            ['select * from public.mcp_list_issues($1)', [a.hash]],
            ['select * from public.mcp_get_issue($1,$2)', [a.hash, f.issue]],
          ]) await denied(query, args)
        })
      }
      await backend(() => denied('select * from public.issue_mcp_connection_token($1,$2,$3)', [f.project, f.member, 'Backend not a human']))
      await asRole('anon', null, () => denied('select * from public.issue_mcp_connection_token($1,$2,$3)', [f.project, f.member, 'Anonymous']))
    })

    await check('non-Owners, foreign Owners, missing humans and delegated OAuth claims cannot issue', async () => {
      for (const actor of [f.qa, f.dev, f.member, f.outsider, f.otherOwner, null]) {
        await human(actor, () => denied('select * from public.issue_mcp_connection_token($1,$2,$3)', [f.project, f.member, 'Forbidden']))
      }
      await human(f.owner, () => denied('select * from public.issue_mcp_connection_token($1,$2,$3)', [f.otherProject, f.member, 'Foreign project']))
      await human(f.owner, () => denied('select * from public.issue_mcp_connection_token($1,$2,$3)', [f.project, f.outsider, 'Nonmember']))
      await human(f.owner, () => denied('select * from public.issue_mcp_connection_token($1,$2,$3)', [f.project, f.member, 'Delegated']), { client_id: randomUUID() })
      await human(f.owner, () => denied('select * from public.issue_mcp_connection_token($1,$2,$3)', [f.project, f.member, 'Wrong role']), { role: 'service_role' })
      assert.equal((await db.query('select count(*)::int as n from public.mcp_connections')).rows[0].n, 3)
    })

    await check('issuance rejects invalid labels and missing/nonmember principals atomically', async () => {
      for (const label of ['', '   ', 'x'.repeat(121), null]) {
        await human(f.owner, () => denied('select * from public.issue_mcp_connection_token($1,$2,$3)', [f.project, f.member, label], '22023'))
      }
      for (const user of [null, randomUUID()]) {
        await human(f.owner, () => denied('select * from public.issue_mcp_connection_token($1,$2,$3)', [f.project, user, 'Invalid principal']))
      }
      assert.equal((await db.query('select count(*)::int as n from public.mcp_connections')).rows[0].n, 3)
    })

    await check('browser reads expose only authorized metadata; hashes and direct writes stay denied', async () => {
      for (const actor of [f.owner, f.member]) {
        await human(actor, async () => {
          assert.equal((await db.query('select id,project_id,user_id,approved_by,client_label,created_at,updated_at,revoked_at,token_expires_at from public.mcp_connections where id=$1', [a.id])).rows.length, 1)
          await denied('select token_hash from public.mcp_connections where id=$1', [a.id])
          await denied('select * from public.mcp_connections where id=$1', [a.id])
          await denied('update public.mcp_connections set token_hash=$1 where id=$2', ['0'.repeat(64), a.id])
          await denied('update public.mcp_connections set approved_by=$1 where id=$2', [f.member, a.id])
          await denied('update public.mcp_connections set revoked_at=now() where id=$1', [a.id])
          await denied('delete from public.mcp_connections where id=$1', [a.id])
          await denied('insert into public.mcp_connections(project_id,user_id,approved_by,client_label,token_hash) values($1,$2,$3,$4,$5)', [f.project, f.member, f.owner, 'Direct insert', '0'.repeat(64)])
          assert.equal((await db.query("select has_column_privilege(current_user,'public.mcp_connections','token_hash','SELECT') as allowed")).rows[0].allowed, false)
        })
      }
      for (const actor of [f.qa, f.outsider, f.otherOwner]) {
        await human(actor, async () => assert.equal((await db.query('select id from public.mcp_connections where project_id=$1', [f.project])).rows.length, 0))
      }
      await human(f.owner, async () => assert.equal((await db.query('select id from public.mcp_connections where id=$1', [other.id])).rows.length, 0))
    })

    await check('backend reads return exact fields, normalize NULL descriptions and leave workflows untouched', async () => {
      const before = (await db.query('select * from public.issues where project_id=$1 order by id', [f.project])).rows
      await backend(async () => {
        assert.equal((await db.query('select current_user as actor')).rows[0].actor, 'service_role')
        const identity = (await db.query('select * from public.resolve_mcp_connection(p_token_hash => $1)', [a.hash])).rows
        assert.deepEqual(identity, [{ connection_id: a.id, user_id: f.member, project_id: f.project }])
        const projects = (await db.query('select * from public.mcp_list_projects(p_token_hash => $1)', [a.hash])).rows
        assert.deepEqual(projects, [{ id: f.project, name: 'Synthetic MCP regression', key: 'MCPTESTA' }])
        const issues = (await db.query('select * from public.mcp_list_issues(p_token_hash => $1)', [a.hash])).rows
        assert.equal(issues.length, 20)
        assert.deepEqual(Object.keys(issues[0]).sort(), ['id', 'issue_number', 'priority', 'project_id', 'status', 'title'])
        assert.equal(issues.every((row) => row.project_id === f.project && row.status === 'OPEN'), true)
        const detail = (await db.query('select * from public.mcp_get_issue(p_token_hash => $1,p_issue_id => $2)', [a.hash, f.issue])).rows[0]
        assert.deepEqual(Object.keys(detail).sort(), ['description', 'id', 'issue_number', 'priority', 'project_id', 'status', 'title'])
        assert.equal(detail.description, 'Synthetic details')
        assert.equal((await db.query('select * from public.mcp_get_issue($1,$2)', [a.hash, f.nullDescriptionIssue])).rows[0].description, '')
      })
      assert.deepEqual((await db.query('select * from public.issues where project_id=$1 order by id', [f.project])).rows, before)
      assert.equal((await db.query('select count(*)::int as n from public.ai_findings')).rows[0].n, 0)
    })

    await check('pagination is bounded and deterministic; invalid limits, offsets and enum inputs fail', async () => {
      await backend(async () => {
        const page = async (limit, offset, status = null) => (await db.query('select * from public.mcp_list_issues(p_token_hash=>$1,p_limit=>$2,p_offset=>$3,p_status=>$4)', [a.hash, limit, offset, status])).rows
        const first = await page(50, 0)
        assert.equal(first.length, 50)
        assert.deepEqual(first.map((row) => row.issue_number), Array.from({ length: 50 }, (_, i) => i + 1))
        assert.deepEqual((await page(50, 50)).map((row) => row.issue_number), [51, 52, 53, 54, 55])
        assert.deepEqual(await page(50, 10000), [])
        assert.equal((await page(1, 0, 'OPEN')).length, 1)
        assert.deepEqual(await page(50, 0, 'FOR_TESTING'), [])
        for (const [limit, offset] of [[null, 0], [0, 0], [-1, 0], [51, 0], [20, null], [20, -1], [20, 10001]]) {
          await denied('select * from public.mcp_list_issues($1,$2,$3)', [a.hash, limit, offset], '22023')
        }
        await denied('select * from public.mcp_list_issues($1,1,0,$2)', [a.hash, 'NOT_A_STATUS'], '22P02')
      })
    })

    await check('project scoping overrides broader browser membership and supplied foreign issue IDs', async () => {
      await human(f.member, async () => assert.equal((await db.query('select id from public.projects where id in ($1,$2)', [f.project, f.otherProject])).rows.length, 2))
      await backend(async () => {
        assert.deepEqual((await db.query('select id from public.mcp_list_projects($1)', [a.hash])).rows, [{ id: f.project }])
        assert.deepEqual((await db.query('select * from public.mcp_get_issue($1,$2)', [a.hash, f.otherIssue])).rows, [])
        assert.deepEqual((await db.query('select * from public.mcp_get_issue($1,$2)', [a.hash, randomUUID()])).rows, [])
        assert.deepEqual((await db.query('select * from public.mcp_get_issue($1,$2)', [a.hash, null])).rows, [])
        assert.equal((await db.query('select * from public.mcp_get_issue($1,$2)', [other.hash, f.otherIssue])).rows.length, 1)
        assert.equal((await db.query('select * from public.mcp_list_issues($1)', [other.hash])).rows.every((row) => row.project_id === f.otherProject), true)
      })
    })

    await check('malformed, missing and unknown hashes deny every resolver/read RPC', async () => {
      for (const value of [null, '', 'invalid', '0'.repeat(64), a.hash.toUpperCase(), `tqm_${'a'.repeat(64)}`]) await noAccess(value)
    })

    await check('revoking one connection immediately denies its reads without revoking sibling connections', async () => {
      for (const actor of [f.member, f.qa, f.outsider, f.otherOwner]) {
        await human(actor, () => denied('select public.revoke_mcp_connection($1)', [a.id]))
      }
      await human(f.owner, () => db.query('select public.revoke_mcp_connection($1)', [a.id]))
      const first = (await db.query('select revoked_at from public.mcp_connections where id=$1', [a.id])).rows[0].revoked_at
      assert.ok(first)
      await human(f.owner, () => db.query('select public.revoke_mcp_connection($1)', [a.id]))
      assert.deepEqual((await db.query('select revoked_at from public.mcp_connections where id=$1', [a.id])).rows[0].revoked_at, first)
      await noAccess(a.hash)
      await backend(async () => assert.equal((await db.query('select * from public.mcp_list_projects($1)', [second.hash])).rows.length, 1))
    })

    await check('expired tokens deny all reads while retained connection history remains intact', async () => {
      await db.query("update public.mcp_connections set created_at=statement_timestamp()-interval '100 days',token_expires_at=statement_timestamp()-interval '1 second' where id=$1", [a.id])
      await noAccess(a.hash)
      assert.equal((await db.query('select count(*)::int as n from public.mcp_connections where id=$1', [a.id])).rows[0].n, 1)
    })

    for (const [name, update] of [
      ['disabled MCP', 'update public.projects set mcp_enabled=false where id=$1'],
      ['archived project', 'update public.projects set archived=true,archived_at=statement_timestamp() where id=$1'],
    ]) {
      await check(`${name} denies all reads and issuance, but Owner revocation remains possible`, async () => {
        await human(f.owner, () => db.query(update, [f.project]))
        await noAccess(a.hash)
        await human(f.owner, () => denied('select * from public.issue_mcp_connection_token($1,$2,$3)', [f.project, f.member, 'Blocked']))
        await human(f.owner, () => db.query('select public.revoke_mcp_connection($1)', [a.id]))
        assert.ok((await db.query('select revoked_at from public.mcp_connections where id=$1', [a.id])).rows[0].revoked_at)
      })
    }

    await check('all projects MCP-disabled deny existing connections and token issuance without 0034', async () => {
      assert.equal((await db.query("select to_regprocedure('public.admit_mcp_request()') is null as absent")).rows[0].absent, true)
      await human(f.owner, () => db.query('update public.projects set mcp_enabled=false where id=$1', [f.project]))
      await human(f.otherOwner, () => db.query('update public.projects set mcp_enabled=false where id=$1', [f.otherProject]))
      assert.equal((await db.query('select count(*)::int as n from public.projects where mcp_enabled')).rows[0].n, 0)
      await noAccess(a.hash)
      await noAccess(other.hash)
      for (const [owner, project] of [[f.owner, f.project], [f.otherOwner, f.otherProject]]) {
        await human(owner, () => denied('select * from public.issue_mcp_connection_token($1,$2,$3)', [project, f.member, 'Inactive pilot']))
      }
    })

    await check('removing current membership denies all reads without rewriting audit history', async () => {
      await human(f.owner, () => db.query('delete from public.project_members where project_id=$1 and user_id=$2', [f.project, f.member]))
      await noAccess(a.hash)
      assert.equal((await db.query('select user_id from public.mcp_connections where id=$1', [a.id])).rows[0].user_id, f.member)
      await human(f.member, async () => assert.equal((await db.query('select id from public.mcp_connections where id=$1', [a.id])).rows.length, 0))
    })

    await check('missing approval or deleted linked account cannot authorize access', async () => {
      await db.exec('savepoint missing_approval')
      await db.query('update public.mcp_connections set approved_by=null where id=$1', [a.id])
      await noAccess(a.hash)
      await db.exec('rollback to savepoint missing_approval; release savepoint missing_approval')
      await db.query('delete from auth.users where id=$1', [f.member])
      assert.equal((await db.query('select user_id from public.mcp_connections where id=$1', [a.id])).rows[0].user_id, null)
      await noAccess(a.hash)
    })

    await check('browser issue creation, assigned development, reporter verification and closure still work', async () => {
      await human(f.dev, () => denied('insert into public.issues(project_id,title) values($1,$2)', [f.project, 'Developer cannot report']))
      await human(f.member, () => denied("update public.issues set status='IN_PROGRESS' where id=$1", [f.issue], 'P0001'))
      await human(f.dev, async () => {
        await db.query("update public.issues set status='IN_PROGRESS' where id=$1", [f.issue])
        await db.query("update public.issues set status='FOR_TESTING' where id=$1", [f.issue])
        await denied("update public.issues set status='PASSED' where id=$1", [f.issue])
      })
      await human(f.owner, () => denied("select public.qa_verify_issue($1,'PASSED',null,null)", [f.issue]))
      await human(f.qa, () => db.query("select public.qa_verify_issue($1,'FAILED',null,'Synthetic rework needed')", [f.issue]))
      await human(f.dev, async () => {
        await db.query("update public.issues set status='IN_PROGRESS' where id=$1", [f.issue])
        await db.query("update public.issues set status='FOR_TESTING' where id=$1", [f.issue])
      })
      await human(f.qa, async () => {
        await db.query("select public.qa_verify_issue($1,'PASSED','Synthetic verification',null)", [f.issue])
        await db.query("update public.issues set status='DONE' where id=$1", [f.issue])
      })
      assert.equal((await db.query('select reporter_id from public.issues where id=$1', [f.issue])).rows[0].reporter_id, f.qa)
      assert.equal((await db.query('select count(*)::int as n from public.qa_verifications where issue_id=$1', [f.issue])).rows[0].n, 2)
      await backend(async () => assert.equal((await db.query('select status from public.mcp_get_issue($1,$2)', [a.hash, f.issue])).rows[0].status, 'DONE'))
    })
  } finally {
    await db.exec('rollback; reset role')
  }
}
