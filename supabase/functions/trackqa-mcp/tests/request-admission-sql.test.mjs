import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('review-draft admission SQL uses shared persistent state and backend-only privileges', async t => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create role unrelated;
      grant usage on schema public to anon, authenticated, service_role, unrelated;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;`)
    await db.exec(await readFile(new URL('../sql-drafts/0034_mcp_request_admission.sql', import.meta.url), 'utf8'))
    const call = () => db.query('select * from public.admit_mcp_request()')
    await t.test('browser and PUBLIC execution/default grants are removed', async () => {
      for (const role of ['anon', 'authenticated', 'unrelated']) {
        await db.exec(`set role ${role}`)
        try { await assert.rejects(call(), error => error.code === '42501') }
        finally { await db.exec('reset role') }
      }
      const { rows: [row] } = await db.query(`select has_function_privilege('service_role','public.admit_mcp_request()','EXECUTE') allowed,
        has_table_privilege('service_role','public.mcp_request_budget','UPDATE') direct_write,
        (select relrowsecurity from pg_class where oid='public.mcp_request_budget'::regclass) rls`)
      assert.deepEqual(row, { allowed: true, direct_write: false, rls: true })
      for (const role of ['anon', 'authenticated', 'service_role', 'unrelated']) {
        await db.exec(`set role ${role}`)
        try {
          await assert.rejects(db.query('select * from public.mcp_request_budget'), error => error.code === '42501')
          await assert.rejects(db.query('update public.mcp_request_budget set tokens=60'), error => error.code === '42501')
        } finally { await db.exec('reset role') }
      }
    })
    await t.test('queued calls share one backend budget (single PGlite session, not lock contention)', async () => {
      // Freeze refill through a synthetic future timestamp. PGlite serializes
      // queries; this is not a hosted multi-session/row-lock contention test.
      await db.exec(`update public.mcp_request_budget set tokens=60, refreshed_at=clock_timestamp()+interval '1 hour'; set role service_role`)
      let results
      try { results = await Promise.all(Array.from({ length: 80 }, call)) }
      finally { await db.exec('reset role') }
      assert.equal(results.filter(r => r.rows[0].allowed).length, 60)
      assert.equal(results.filter(r => !r.rows[0].allowed && r.rows[0].retry_after_seconds === 1).length, 20)
      const { rows } = await db.query('select tokens from public.mcp_request_budget')
      assert.equal(Number(rows[0].tokens), 0)
    })
    await t.test('fractional credits cannot admit a request, and backwards clock movement cannot refill', async () => {
      await db.exec(`update public.mcp_request_budget set tokens=0.999999, refreshed_at=clock_timestamp()+interval '1 hour'`)
      const before = (await db.query('select tokens, refreshed_at from public.mcp_request_budget')).rows
      assert.deepEqual((await call()).rows, [{ allowed: false, retry_after_seconds: 1 }])
      assert.deepEqual((await db.query('select tokens, refreshed_at from public.mcp_request_budget')).rows, before)
      await db.exec('update public.mcp_request_budget set tokens=1')
      assert.deepEqual((await call()).rows, [{ allowed: true, retry_after_seconds: 0 }])
      assert.deepEqual((await call()).rows, [{ allowed: false, retry_after_seconds: 1 }])
      assert.equal(Number((await db.query('select tokens from public.mcp_request_budget')).rows[0].tokens), 0)
    })
    await t.test('elapsed time replenishes the budget but never above the burst capacity', async () => {
      await db.exec(`update public.mcp_request_budget set tokens=0, refreshed_at=clock_timestamp()-interval '1 hour'`)
      assert.deepEqual((await call()).rows, [{ allowed: true, retry_after_seconds: 0 }])
      assert.equal(Number((await db.query('select tokens from public.mcp_request_budget')).rows[0].tokens), 59)
    })
    await t.test('credit consumption is transactional and successful backend calls commit one debit', async () => {
      await db.exec(`update public.mcp_request_budget set tokens=2, refreshed_at=clock_timestamp()+interval '1 hour'`)
      await db.exec('begin; set local role service_role')
      try { assert.deepEqual((await call()).rows, [{ allowed: true, retry_after_seconds: 0 }]) }
      finally { await db.exec('rollback') }
      assert.equal(Number((await db.query('select tokens from public.mcp_request_budget')).rows[0].tokens), 2)
      await db.exec('set role service_role')
      try { assert.deepEqual((await call()).rows, [{ allowed: true, retry_after_seconds: 0 }]) }
      finally { await db.exec('reset role') }
      assert.equal(Number((await db.query('select tokens from public.mcp_request_budget')).rows[0].tokens), 1)
    })
    await t.test('missing state fails closed, and the function has a fixed path and bounded lock wait', async () => {
      const { rows: [row] } = await db.query(`select prosecdef, proconfig from pg_proc where oid='public.admit_mcp_request()'::regprocedure`)
      assert.equal(row.prosecdef, true)
      assert.ok(row.proconfig.includes('search_path=pg_catalog, public, pg_temp'))
      assert.ok(row.proconfig.includes('lock_timeout=100ms'))
      await db.exec('delete from public.mcp_request_budget')
      await assert.rejects(call(), error => error.code === '55000')
    })
  } finally { await db.close() }
})
