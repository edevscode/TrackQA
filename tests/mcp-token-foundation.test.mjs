import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'

// Static security-contract checks ONLY. No SQL parser/engine, connections,
// migration execution, random token generation, or credential issuance.
const migrationUrl = new URL('../supabase/migrations/0033_mcp_foundation.sql', import.meta.url)
const source = await readFile(migrationUrl, 'utf8')
const uncomment = (text) => text.replace(/--[^\n]*/g, '')
const sql = uncomment(source)
const sha256 = (text) => createHash('sha256').update(text).digest('hex')

function functionDefinition(text, name) {
  const match = uncomment(text).match(new RegExp(`create function public\\.${name}\\(([\\s\\S]*?)\\)\\s*returns([\\s\\S]*?)as \\$\\$([\\s\\S]*?)\\$\\$;`, 'i'))
  assert.ok(match, `${name} definition must exist`)
  return { args: match[1], header: match[2], body: match[3] }
}
const issue = functionDefinition(source, 'issue_mcp_connection_token')
const revoke = functionDefinition(source, 'revoke_mcp_connection')
const resolve = functionDefinition(source, 'resolve_mcp_connection')
const readNames = ['mcp_list_projects', 'mcp_list_issues', 'mcp_get_issue']
const reads = readNames.map((name) => functionDefinition(source, name))

function assertHumanOwnerIssuance(text) {
  const { body } = functionDefinition(text, 'issue_mcp_connection_token')
  assert.match(body, /v_actor uuid := auth\.uid\(\)/)
  assert.match(body, /v_actor is null or coalesce\(auth\.jwt\(\) ->> 'role', ''\) <> 'authenticated'/)
  assert.match(body, /\(auth\.jwt\(\) ->> 'client_id'\) is not null/)
  assert.match(body, /m\.project_id = p_project_id and m\.user_id = v_actor and m\.role = 'OWNER'\s+for share;\s+if not found then\s+raise exception/)
  assert.match(body, /m\.project_id = p_project_id and m\.user_id = p_user_id\s+for share;\s+if not found then\s+raise exception/)
  assert.match(body, /p\.id = p_project_id and p\.mcp_enabled and not p\.archived\s+for share;\s+if not found then\s+raise exception/)
  assert.ok(body.indexOf("m.role = 'OWNER'") < body.indexOf('gen_random_bytes'))
  assert.ok(body.indexOf('m.user_id = p_user_id') < body.indexOf('gen_random_bytes'))
}

function assertLiveResolution(text) {
  const { args, body } = functionDefinition(text, 'resolve_mcp_connection')
  assert.equal(args.trim(), 'p_token_hash text')
  for (const condition of [
    "p_token_hash ~ '^[0-9a-f]{64}$'", 'c.token_hash = p_token_hash',
    'c.user_id is not null', 'c.approved_by is not null', 'c.revoked_at is null',
    'c.token_expires_at > statement_timestamp()', 'p.mcp_enabled', 'not p.archived',
    'p.id = c.project_id', 'm.project_id = c.project_id and m.user_id = c.user_id',
  ]) assert.ok(body.includes(condition), `resolver must enforce ${condition}`)
  assert.match(body, /select c\.id, c\.user_id, c\.project_id\s+from public\.mcp_connections c/)
  assert.doesNotMatch(body, /\b(insert|update|delete|execute|set_config)\b/i)
}

function assertCredentialPermissions(text) {
  const statements = uncomment(text)
  assert.match(statements, /revoke all on public\.mcp_connections, public\.ai_findings from public, anon, authenticated;/)
  const metadata = statements.match(/grant select \(([^)]+)\)\s+on public\.mcp_connections to authenticated;/)
  assert.ok(metadata, 'browser reads must use explicit metadata columns')
  assert.doesNotMatch(metadata[1], /token_hash/)
  assert.doesNotMatch(statements, /grant\s+(?:all|insert|update|delete|truncate|select)\s+on\s+public\.mcp_connections\s+to\s+(?:public|anon|authenticated)/i)
  assert.doesNotMatch(statements, /create policy[^;]*on public\.mcp_connections\s+for (?:all|insert|update|delete)/i)
  const grants = [...statements.matchAll(/grant execute on function public\.(\w+)\(([^)]*)\) to ([\w, ]+);/g)]
  assert.deepEqual(grants.map(([, name, args, role]) => [name, args, role]), [
    ['issue_mcp_connection_token', 'uuid, uuid, text', 'authenticated'],
    ['revoke_mcp_connection', 'uuid', 'authenticated'],
    ['resolve_mcp_connection', 'text', 'service_role'],
    ['mcp_list_projects', 'text', 'service_role'],
    ['mcp_list_issues', 'text, integer, integer, public.issue_status', 'service_role'],
    ['mcp_get_issue', 'text, uuid', 'service_role'],
  ])
  for (const [, name, args] of grants) {
    assert.ok(statements.includes(`revoke all on function public.${name}(${args}) from public, anon, authenticated, service_role;`))
  }
}

test('0033 retains a single transaction and creates no extra token/grant tables', () => {
  assert.match(sql.trim(), /^begin;/)
  assert.match(sql.trim(), /commit;$/)
  assert.deepEqual([...sql.matchAll(/create table public\.(\w+)/g)].map(([, name]) => name), ['mcp_connections', 'ai_findings'])
  assert.equal([...sql.matchAll(/create function public\./g)].length, 6)
  // Defining the functions must not invoke them or generate credentials.
  const outsideFunctions = sql.replace(/create function[\s\S]*?\$\$;/g, '')
  assert.doesNotMatch(outsideFunctions, /gen_random_bytes|\b(?:insert into|select public\.(?:issue|resolve|revoke)_mcp)\b/i)
})

test('connection storage contains only a unique bounded hash and finite expiry', () => {
  const table = sql.match(/create table public\.mcp_connections \(([\s\S]*?)\n\);/)[1]
  assert.match(table, /token_hash text not null/)
  assert.match(table, /unique \(token_hash\)/)
  assert.match(table, /check \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/)
  assert.match(table, /token_expires_at timestamptz not null default \(now\(\) \+ interval '90 days'\)/)
  assert.match(table, /check \(token_expires_at > created_at\)/)
  assert.doesNotMatch(table, /\b(?:access_token|plaintext_token|token_secret|refresh_token)\s+(?:text|bytea|varchar)/i)
  assert.match(table, /project_id uuid not null references public\.projects\(id\)/)
  assert.match(table, /user_id uuid references public\.profiles\(id\) on delete set null/)
  assert.match(table, /approved_by uuid references public\.profiles\(id\) on delete set null/)
})

test('only a human Owner may issue for a current member of an enabled active project', () => {
  assertHumanOwnerIssuance(source)
})

test('tokens are generated internally with 256 random bits and only their complete SHA-256 hash is inserted', () => {
  assert.match(issue.args, /^\s*p_project_id uuid,\s*p_user_id uuid,\s*p_client_label text\s*$/)
  assert.match(issue.body, /v_token := 'tqm_' \|\| encode\(gen_random_bytes\(32\), 'hex'\);/)
  const insertion = issue.body.match(/insert into public\.mcp_connections\s*\(([^)]+)\) values \(([\s\S]*?)\) returning id into v_id;/)
  assert.ok(insertion)
  assert.doesNotMatch(insertion[1], /access_token|v_token/)
  assert.match(insertion[2], /p_project_id, p_user_id, v_actor, p_client_label,/)
  assert.match(insertion[2], /encode\(digest\(v_token, 'sha256'\), 'hex'\)/)
  assert.match(insertion[2], /v_now, v_now, v_now \+ interval '90 days'/)
  assert.equal(insertion[2].match(/\bv_token\b/g).length, 1, 'plaintext may appear only as digest input')
  assert.match(issue.body, /return query select v_id, v_token;/)
  assert.doesNotMatch(issue.body, /raise (?:notice|log|warning|debug)|md5\(|random\(/i)
})

test('labels are bounded before token generation', () => {
  assert.match(issue.body, /p_client_label is null or char_length\(p_client_label\) not between 1 and 120/)
  assert.match(issue.body, /p_client_label !~ '\[\^\[:space:\]\]'/)
  assert.ok(issue.body.indexOf('char_length(p_client_label)') < issue.body.indexOf('gen_random_bytes'))
})

test('revocation is Owner-only, idempotent and remains available after disable/archive/expiry', () => {
  assert.equal(revoke.args.trim(), 'p_connection_id uuid')
  assert.match(revoke.body, /v_actor uuid := auth\.uid\(\)/)
  assert.match(revoke.body, /v_actor is null or coalesce\(auth\.jwt\(\) ->> 'role', ''\) <> 'authenticated'/)
  assert.match(revoke.body, /\(auth\.jwt\(\) ->> 'client_id'\) is not null/)
  assert.match(revoke.body, /m\.project_id = v_project_id and m\.user_id = v_actor and m\.role = 'OWNER'\s+for share;\s+if not found then\s+raise exception/)
  assert.match(revoke.body, /set revoked_at = greatest\(statement_timestamp\(\), c\.created_at\)\s+where c\.id = p_connection_id and c\.revoked_at is null/)
  assert.doesNotMatch(revoke.body, /mcp_enabled|archived|token_expires_at|\bdelete\b|set token_hash|revoked_at = null/i)
})

test('server-only resolution enforces every live eligibility check and returns only scoped identity', () => {
  assertLiveResolution(source)
  assert.match(resolve.header, /table \(connection_id uuid, user_id uuid, project_id uuid\)/)
  assert.match(resolve.header, /\bstable\b/)
})

test('ordinary clients cannot read hashes, write approvals or call the resolver', () => {
  assertCredentialPermissions(source)
})

test('all new definer functions have fixed trusted search paths and no dynamic SQL', () => {
  for (const definition of [issue, revoke, resolve, ...reads]) {
    assert.match(definition.header, /security definer\s+set search_path = pg_catalog, public, (?:extensions, )?pg_temp/)
    assert.doesNotMatch(definition.body, /\bexecute\b|set_config|current_setting|raise (?:log|notice|warning|debug)/i)
  }
})

function assertScopedRead(text, name) {
  assertLiveResolution(text)
  const { args, header, body } = functionDefinition(text, name)
  assert.match(args, /^p_token_hash text$|^\s*p_token_hash text,/)
  assert.doesNotMatch(args, /p_project_id|p_user_id|p_connection_id|access_token/)
  assert.match(header, /\bstable\b/)
  assert.match(header, /security definer\s+set search_path = pg_catalog, public, pg_temp/)
  assert.equal([...body.matchAll(/\bselect\b/gi)].length, 1, 'authorization and read must share one SELECT')
  assert.match(body, /from public\.resolve_mcp_connection\(p_token_hash\) a\s+join public\.(?:projects p on p\.id|issues i on i\.project_id) = a\.project_id\s+(?:where|order by|limit)\b/)
  assert.doesNotMatch(body, /\b(insert|update|delete|execute|set_config|current_setting|union)\b|select\s+\*|\w\.\*/i)
  assert.doesNotMatch(body, /auth\.uid|auth\.jwt|token_hash\s*=|raise (?:log|notice|warning|debug)/i)
  const signature = name === 'mcp_list_issues' ? 'text, integer, integer, public.issue_status'
    : name === 'mcp_get_issue' ? 'text, uuid' : 'text'
  assert.ok(uncomment(text).includes(`revoke all on function public.${name}(${signature}) from public, anon, authenticated, service_role;`))
  const grants = [...uncomment(text).matchAll(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to ([\\w, ]+);`, 'g'))]
  assert.deepEqual(grants.map(([, role]) => role), ['service_role'])
}

test('each read RPC derives project access from live token resolution inside its SELECT', () => {
  for (const name of readNames) assertScopedRead(source, name)
  assert.equal(reads[0].args, 'p_token_hash text')
  assert.match(reads[1].args, /^\s*p_token_hash text,\s*p_limit integer default 20,\s*p_offset integer default 0,\s*p_status public\.issue_status default null\s*$/)
  assert.equal(reads[2].args, 'p_token_hash text, p_issue_id uuid')
})

test('read projections expose only explicit project/issue fields with one-row detail bounds', () => {
  const columns = (definition) => definition.header.split('language')[0].replace(/\s+/g, ' ').trim()
  assert.equal(columns(reads[0]), 'table (id uuid, name text, key text)')
  assert.equal(columns(reads[1]), 'table ( id uuid, project_id uuid, issue_number integer, title text, status public.issue_status, priority public.issue_priority )')
  assert.equal(columns(reads[2]), 'table ( id uuid, project_id uuid, issue_number integer, title text, description text, status public.issue_status, priority public.issue_priority )')
  assert.match(reads[0].body, /select p\.id, p\.name, p\.key/)
  assert.match(reads[0].body, /limit 1;/)
  assert.match(reads[1].body, /select i\.id, i\.project_id, i\.issue_number, i\.title, i\.status, i\.priority/)
  assert.doesNotMatch(reads[1].body, /description|count\(|jsonb?_agg/i)
  assert.match(reads[2].body, /select i\.id, i\.project_id, i\.issue_number, i\.title,\s+coalesce\(i\.description, ''\), i\.status, i\.priority/)
  assert.match(reads[2].body, /where i\.id = p_issue_id\s+limit 1;/)
  for (const definition of reads) assert.doesNotMatch(definition.body, /approved_by|token_expires_at|service_role|access_token|reporter_id|assignee_id|access_code/)
})

function assertPagination(text) {
  const { body } = functionDefinition(text, 'mcp_list_issues')
  assert.match(body, /if p_limit is null or p_limit not between 1 and 50\s+or p_offset is null or p_offset not between 0 and 10000 then\s+raise exception 'Invalid MCP pagination' using errcode = '22023';\s+end if;/)
  assert.ok(body.indexOf('end if;') < body.indexOf('return query'))
  assert.match(body, /where p_status is null or i\.status = p_status/)
  assert.match(body, /order by i\.issue_number asc, i\.id asc\s+limit p_limit offset p_offset;/)
  assert.doesNotMatch(body, /\bexecute\b|format\(|string_agg|count\(/i)
}

test('pagination explicitly rejects NULL and out-of-range inputs before reading and sorts deterministically', () => {
  assertPagination(source)
})

test('read security checks detect missing authorization joins, weakened resolver predicates and broad grants', () => {
  for (const name of readNames) {
    const definition = functionDefinition(source, name)
    const changed = (body) => uncomment(source).replace(definition.body, body)
    // Function bodies are comment-free, so the read SELECTs can be targeted
    // without accidentally changing an earlier Owner or resolver function.
    assert.throws(() => assertScopedRead(changed(definition.body.replace('public.resolve_mcp_connection(p_token_hash)', 'public.unchecked_connection(p_token_hash)')), name))
    assert.throws(() => assertScopedRead(changed(definition.body.replace('= a.project_id', '= a.project_id or true')), name))
    assert.throws(() => assertScopedRead(source.replaceAll('c.revoked_at is null', 'true'), name))
    assert.throws(() => assertScopedRead(source.replaceAll('c.token_expires_at > statement_timestamp()', 'true'), name))
    assert.throws(() => assertScopedRead(source.replace(new RegExp(`(grant execute on function public\\.${name}\\([^)]*\\) to )service_role`), '$1authenticated'), name))
  }
})

test('pagination checks detect removed NULL guards and an expanded maximum', () => {
  for (const guard of ['p_limit is null or ', 'p_offset is null or ']) {
    assert.throws(() => assertPagination(source.replace(guard, '')))
  }
  assert.throws(() => assertPagination(source.replace('p_limit not between 1 and 50', 'p_limit not between 1 and 5000')))
})

test('security checks detect removed Owner, project, membership, revocation and expiry conditions', () => {
  for (const condition of ["and m.role = 'OWNER'", 'and p.mcp_enabled and not p.archived', 'and m.user_id = p_user_id']) {
    assert.throws(() => assertHumanOwnerIssuance(source.replaceAll(condition, '')), condition)
  }
  for (const condition of ['c.revoked_at is null', 'c.token_expires_at > statement_timestamp()',
    'c.approved_by is not null', 'm.project_id = c.project_id and m.user_id = c.user_id',
    "where p_token_hash ~ '^[0-9a-f]{64}$'", 'and c.token_hash = p_token_hash']) {
    assert.throws(() => assertLiveResolution(source.replaceAll(condition, 'true')), condition)
  }
})

test('security checks detect accidentally exposed hash columns and browser resolver execution', () => {
  assert.throws(() => assertCredentialPermissions(source.replace('grant select (id, project_id', 'grant select (token_hash, id, project_id')))
  assert.throws(() => assertCredentialPermissions(source.replace('resolve_mcp_connection(text) to service_role', 'resolve_mcp_connection(text) to authenticated')))
})

test('ai_findings schema is byte-for-byte unchanged from the reviewed pre-token draft', () => {
  const findings = source.slice(source.indexOf('create table public.ai_findings ('), source.indexOf('-- A completed review'))
  assert.equal(sha256(findings), '2cc195909005a57940b37c4d1dd670a9e206e4625e646f45cb5222e9d91174f3')
  assert.match(sql, /grant select on public\.ai_findings to authenticated;/)
  assert.match(sql, /create policy ai_findings_select_reviewer[\s\S]*?using \(public\.get_project_role\(project_id\) in \('QA', 'OWNER'\)\);/)
  assert.doesNotMatch(sql, /create policy[^;]*on public\.ai_findings\s+for (?:all|insert|update|delete)/i)
})

test('all 32 original migrations retain their independently reviewed fingerprint', async () => {
  const directory = new URL('../supabase/migrations/', import.meta.url)
  const names = (await readdir(directory)).filter((name) => /^00(0[1-9]|[12][0-9]|3[0-2])_.*\.sql$/.test(name)).sort()
  assert.equal(names.length, 32)
  let manifest = ''
  for (const name of names) manifest += `${name} ${sha256(await readFile(new URL(name, directory)))}\n`
  assert.equal(sha256(manifest), '1d67b36140f4fddab60e5926bb640ee84f8c0fec7eab5abf480d5cbee4464e53')
})

test('deferred Edge contract requires fresh checks, no credential logging and no plaintext persistence', () => {
  for (const contract of [
    'never persist', 'hash the complete token with SHA-256', 'Never cache positive authorization across requests',
    'Rate-limit failed validation without logging tokens or their hashes',
    'each future data RPC must repeat', 'SAME operation', 'not compatible with OAuth-only',
  ]) assert.ok(source.includes(contract), contract)
  assert.doesNotMatch(sql, /create role|alter role|auth\.users|create extension|create (?:or replace )?function public\.(?:qa_verify_issue|enforce_issue_status_transition)/i)
})
