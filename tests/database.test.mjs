import { test } from 'node:test'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { seedLegacyDeadlines, assertLegacyDeadlineMigration } from './legacy-deadlines.fixture.mjs'
import { seedLegacyResponsibilities, assertLegacyResponsibilities } from './legacy-responsibilities.fixture.mjs'

// Supabase-owned services are represented by minimal auth/storage schemas.
// Application migrations, RLS, triggers, and SQL regressions run unmodified.
test('PostgreSQL migrations and authorization/deadline regressions', async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } })
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
      create function auth.jwt() returns jsonb language sql stable as
        $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as
        $$ select (auth.jwt() ->> 'sub')::uuid $$;
      grant usage on schema public, auth to authenticated, anon;
      grant execute on all functions in schema auth to authenticated, anon;
      alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
      create schema storage;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint);
      create table storage.objects(id uuid primary key default gen_random_uuid(),
        bucket_id text references storage.buckets(id), name text, owner uuid);
      alter table storage.objects enable row level security;
      create function storage.foldername(path text) returns text[] language sql immutable as
        $$ select (string_to_array(path, '/'))[1:array_length(string_to_array(path, '/'), 1)-1] $$;
      grant usage on schema storage to authenticated, anon;
      grant select, insert, update, delete on all tables in schema storage to authenticated;
      create publication supabase_realtime;
    `)
    let legacyFixture
    let responsibilityFixture
    for (const name of (await readdir(new URL('../supabase/migrations/', import.meta.url))).sort()) {
      if (!name.endsWith('.sql')) continue
      if (name.startsWith('0029_')) legacyFixture = await seedLegacyDeadlines(db)
      if (name.startsWith('0032_')) responsibilityFixture = await seedLegacyResponsibilities(db)
      await t.test(`migration ${name}`, async () => {
        await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'))
      })
      if (name.startsWith('0029_')) {
        await t.test('legacy date-only migration preserves dates, DONE timestamps, and history', async () => {
          await assertLegacyDeadlineMigration(db, legacyFixture)
        })
      }
      if (name.startsWith('0030_')) {
        await t.test('user-local timezone migration preserves existing UTC deadlines and history', async () => {
          await assertLegacyDeadlineMigration(db, legacyFixture)
        })
      }
      if (name.startsWith('0032_')) {
        await t.test('responsibility migration preserves old reports and allows legacy reporters to finish verification', async () => {
          await assertLegacyResponsibilities(db, responsibilityFixture)
        })
      }
    }
    for (const name of (await readdir(new URL('../supabase/tests/', import.meta.url))).sort()) {
      if (!name.endsWith('.sql')) continue
      await t.test(`regression ${name}`, async () => {
        try { await db.exec(await readFile(new URL(`../supabase/tests/${name}`, import.meta.url), 'utf8')) }
        finally { await db.exec('rollback; reset role;') }
      })
    }
  } finally {
    await db.close()
  }
})
