begin;

-- Opaque bearer-token foundation, not OAuth or a Supabase JWT. No agent role,
-- submission/review RPC, or issue-workflow changes. Never give browser JWTs or
-- service-role keys to agents. Only the checked Owner RPC can issue a token.
-- Applying this file creates functions; it does not issue any credentials.

alter table public.projects
  add column mcp_enabled boolean not null default false;

-- Existing projects_update_owner RLS controls the new setting. The switch does
-- not authenticate a connection or grant any access by itself.
comment on column public.projects.mcp_enabled is
  'Owner-controlled MCP switch. Future MCP operations must also validate credentials, project membership, archive state and connection revocation.';

create table public.mcp_connections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  -- Match existing audit conventions: retain history when an account is deleted.
  -- Future creation must require both principals; missing principals must never
  -- authorize MCP access. Role/membership checks belong in the checked contracts
  -- below, not a CHECK constraint that becomes stale when membership changes.
  user_id uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  client_label text not null,
  -- SHA-256 of the COMPLETE tqm_<64 lowercase hex characters> token. The random
  -- suffix has 256 bits of entropy. A hash is never accepted as a bearer token.
  token_hash text not null,
  token_expires_at timestamptz not null default (now() + interval '90 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint mcp_connections_token_hash_unique unique (token_hash),
  constraint mcp_connections_token_hash_format check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint mcp_connections_token_expiry check (token_expires_at > created_at),
  constraint mcp_connections_client_label_bounded check (
    char_length(client_label) between 1 and 120
    and client_label ~ '[^[:space:]]'
  ),
  constraint mcp_connections_revocation_time check (
    revoked_at is null or revoked_at >= created_at
  ),
  -- Composite FK target: a finding cannot claim another connection's project.
  constraint mcp_connections_id_project_key unique (id, project_id)
);

create index mcp_connections_project_created
  on public.mcp_connections(project_id, created_at desc);
create index mcp_connections_user on public.mcp_connections(user_id);

-- Required composite FK target for the resulting issue. This adds an index,
-- not a new issue identity or workflow. Its creation takes a lock on issues;
-- review the deployment window before applying to a populated database.
alter table public.issues
  add constraint issues_id_project_key unique (id, project_id);

create table public.ai_findings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  connection_id uuid not null,
  submission_id text not null,
  title text not null,
  description text not null,
  steps_to_reproduce text,
  expected_result text,
  actual_result text,
  suggested_priority public.issue_priority not null default 'MEDIUM',
  -- Untrusted report metadata, never instructions to read a server-side file.
  file_path text,
  line_start integer,
  line_end integer,
  status text not null default 'PENDING',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  issue_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Retain findings/reviews if a privileged caller accidentally deletes only a
  -- connection. Defer the check so deleting a project can still cascade through
  -- both tables in the same transaction without depending on cascade ordering.
  constraint ai_findings_connection_project_fk
    foreign key (connection_id, project_id)
    references public.mcp_connections(id, project_id) on delete no action
    deferrable initially deferred,
  -- PostgreSQL 15+ column-specific SET NULL preserves the required project_id
  -- when an existing authorized issue deletion clears only the issue reference.
  constraint ai_findings_issue_project_fk
    foreign key (issue_id, project_id)
    references public.issues(id, project_id) on delete set null (issue_id),
  constraint ai_findings_connection_submission_key unique (connection_id, submission_id),
  constraint ai_findings_submission_id_bounded check (
    char_length(submission_id) between 1 and 128
    and submission_id ~ '[^[:space:]]'
  ),
  constraint ai_findings_title_bounded check (
    char_length(title) between 1 and 240 and title ~ '[^[:space:]]'
  ),
  constraint ai_findings_description_bounded check (
    char_length(description) between 1 and 20000
    and description ~ '[^[:space:]]'
  ),
  constraint ai_findings_details_bounded check (
    (steps_to_reproduce is null or char_length(steps_to_reproduce) <= 10000)
    and (expected_result is null or char_length(expected_result) <= 10000)
    and (actual_result is null or char_length(actual_result) <= 10000)
  ),
  constraint ai_findings_file_path_bounded check (
    file_path is null or (
      char_length(file_path) between 1 and 1024 and file_path ~ '[^[:space:]]'
    )
  ),
  constraint ai_findings_line_range check (
    (line_start is null and line_end is null)
    or (file_path is not null and line_start is not null and line_start > 0
      and (line_end is null or line_end >= line_start))
  ),
  constraint ai_findings_status_valid check (
    status in ('PENDING', 'CONFIRMED', 'REJECTED')
  ),
  constraint ai_findings_review_note_bounded check (
    review_note is null or char_length(review_note) <= 4000
  ),
  constraint ai_findings_review_state check (
    (status = 'PENDING' and reviewed_by is null and reviewed_at is null
      and review_note is null and issue_id is null)
    or (status in ('CONFIRMED', 'REJECTED') and reviewed_at is not null
      and (status = 'CONFIRMED' or issue_id is null))
  ),
  constraint ai_findings_review_time check (
    reviewed_at is null or reviewed_at >= created_at
  )
);

-- A completed review may outlive its reviewer account or resulting issue.
-- Future confirmation MUST initially supply reviewer and issue IDs atomically.
-- CONFIRMED remains terminal even if a later deletion sets issue_id to NULL;
-- never interpret a missing issue reference as permission to confirm again.
comment on table public.ai_findings is
  'Unconfirmed AI reports and human review history; writes are closed pending authenticated submission/review RPCs.';

create index ai_findings_project_status_created
  on public.ai_findings(project_id, status, created_at desc);
create index ai_findings_issue on public.ai_findings(issue_id)
  where issue_id is not null;

-- Reuse the existing timestamp helper.
create trigger trg_mcp_connections_set_updated_at
before update on public.mcp_connections
for each row execute function public.set_updated_at();

create trigger trg_ai_findings_set_updated_at
before update on public.ai_findings
for each row execute function public.set_updated_at();

alter table public.mcp_connections enable row level security;
alter table public.ai_findings enable row level security;

-- Override inherited/default browser table grants. No direct INSERT, UPDATE,
-- DELETE, TRUNCATE or other table privileges; no agent role is introduced.
-- Trusted database administrators remain able to administer these tables.
revoke all on public.mcp_connections, public.ai_findings from public, anon, authenticated;
-- Column privileges keep token hashes out of browser SELECT, even for Owners.
-- SELECT * must not accidentally expose a newly added credential column.
grant select (id, project_id, user_id, approved_by, client_label,
  token_expires_at, created_at, updated_at, revoked_at)
  on public.mcp_connections to authenticated;
grant select on public.ai_findings to authenticated;

-- Browser management reads: Owners retain revocation/disabled/archive history.
-- Other users can see only their own currently eligible connection metadata.
-- This is NOT an MCP request-authorization predicate or a credential resolver.
create policy mcp_connections_select_authorized
on public.mcp_connections for select to authenticated
using (
  public.is_project_owner(project_id)
  or (
    user_id = (select auth.uid())
    and approved_by is not null
    and revoked_at is null
    and public.is_project_member(project_id)
    and exists (
      select 1 from public.projects p
      where p.id = mcp_connections.project_id and p.mcp_enabled and not p.archived
    )
  )
);

-- Browser review/history reads only, confined to current QA/Owner membership.
-- Keep findings visible to reviewers after MCP disable/revocation and in an
-- archived project's read-only history. No review write policy is created.
create policy ai_findings_select_reviewer
on public.ai_findings for select to authenticated
using (public.get_project_role(project_id) in ('QA', 'OWNER'));

-- Owner approval and issuance are a single operation. There is no public RPC
-- accepting a caller-selected token/hash/approver and no direct write policy.
-- pgcrypto is installed by 0001, normally in public or extensions on Supabase.
-- Both schemas must remain protected from CREATE by untrusted roles. Keep
-- pg_catalog first and pg_temp last for every SECURITY DEFINER function.
create function public.issue_mcp_connection_token(
  p_project_id uuid,
  p_user_id uuid,
  p_client_label text
)
returns table (connection_id uuid, access_token text)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_token text;
  v_now timestamptz := statement_timestamp();
begin
  -- Only a verified, direct Supabase browser session may manage credentials.
  -- In particular, future delegated OAuth sessions cannot issue MCP tokens.
  if v_actor is null or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated'
     or (auth.jwt() ->> 'client_id') is not null then
    raise exception 'A human TrackQA session is required' using errcode = '42501';
  end if;

  -- Locks serialize approval with project disable/archive and member removal
  -- or role changes. No token is returned if any prerequisite fails.
  perform 1 from public.projects p
  where p.id = p_project_id and p.mcp_enabled and not p.archived
  for share;
  if not found then
    raise exception 'MCP approval unavailable' using errcode = '42501';
  end if;
  perform 1 from public.project_members m
  where m.project_id = p_project_id and m.user_id = v_actor and m.role = 'OWNER'
  for share;
  if not found then
    raise exception 'MCP approval unavailable' using errcode = '42501';
  end if;
  perform 1 from public.project_members m
  where m.project_id = p_project_id and m.user_id = p_user_id
  for share;
  if not found then
    raise exception 'MCP approval unavailable' using errcode = '42501';
  end if;
  if p_client_label is null or char_length(p_client_label) not between 1 and 120
     or p_client_label !~ '[^[:space:]]' then
    raise exception 'A client label of 1 to 120 characters is required' using errcode = '22023';
  end if;

  v_token := 'tqm_' || encode(gen_random_bytes(32), 'hex');
  insert into public.mcp_connections (
    project_id, user_id, approved_by, client_label, token_hash,
    created_at, updated_at, token_expires_at
  ) values (
    p_project_id, p_user_id, v_actor, p_client_label,
    encode(digest(v_token, 'sha256'), 'hex'),
    v_now, v_now, v_now + interval '90 days'
  ) returning id into v_id;
  -- One-time delivery only. Do not log RPC responses, store them in analytics,
  -- or automatically retry issuance after a lost response. Revoke and reissue.
  return query select v_id, v_token;
end;
$$;

create function public.revoke_mcp_connection(p_connection_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_project_id uuid;
begin
  if v_actor is null or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated'
     or (auth.jwt() ->> 'client_id') is not null then
    raise exception 'A human TrackQA session is required' using errcode = '42501';
  end if;
  select c.project_id into v_project_id from public.mcp_connections c
  where c.id = p_connection_id;
  -- Deliberately no enablement/archive/expiry check: Owners must retain the
  -- ability to revoke disabled, expired or archived connections.
  perform 1 from public.project_members m
  where m.project_id = v_project_id and m.user_id = v_actor and m.role = 'OWNER'
  for share;
  if not found then
    raise exception 'Connection unavailable or access denied' using errcode = '42501';
  end if;
  update public.mcp_connections c
  set revoked_at = greatest(statement_timestamp(), c.created_at)
  where c.id = p_connection_id and c.revoked_at is null;
end;
$$;

-- Trusted Edge backend only. The agent has no Supabase API credential and
-- cannot invoke this resolver. The future Edge authorizer must strictly parse
-- the bearer token, hash it with SHA-256, and submit ONLY that hash here.
-- There is deliberately no function taking a connection UUID as authentication.
create function public.resolve_mcp_connection(p_token_hash text)
returns table (connection_id uuid, user_id uuid, project_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select c.id, c.user_id, c.project_id
  from public.mcp_connections c
  join public.projects p on p.id = c.project_id
  join public.project_members m on m.project_id = c.project_id and m.user_id = c.user_id
  where p_token_hash ~ '^[0-9a-f]{64}$'
    and c.token_hash = p_token_hash
    and c.user_id is not null and c.approved_by is not null
    and c.revoked_at is null and c.token_expires_at > statement_timestamp()
    and p.mcp_enabled and not p.archived;
$$;

-- Scoped reads: each SELECT resolves the hash and reads the data in the SAME
-- database operation/snapshot. A previous Edge identity is not a capability.
-- The only project ID used here comes from resolve_mcp_connection, which checks
-- approval, current membership, revocation, expiry, enablement and archive state.
-- Invalid/ineligible credentials return no rows; a foreign/missing issue also
-- returns no rows. In-flight reads are not retroactively cancelled by revocation.
-- These narrow definer functions do not depend on browser RLS or grant agents
-- database roles; they enforce equivalent project-read authorization explicitly.
create function public.mcp_list_projects(p_token_hash text)
returns table (id uuid, name text, key text)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select p.id, p.name, p.key
  from public.resolve_mcp_connection(p_token_hash) a
  join public.projects p on p.id = a.project_id
  limit 1;
$$;

create function public.mcp_list_issues(
  p_token_hash text,
  p_limit integer default 20,
  p_offset integer default 0,
  p_status public.issue_status default null
)
returns table (
  id uuid, project_id uuid, issue_number integer, title text,
  status public.issue_status, priority public.issue_priority
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  -- Explicit NULL checks are essential: LIMIT NULL would be unbounded. Typed
  -- integer/enum arguments constrain pagination and allowed issue statuses.
  if p_limit is null or p_limit not between 1 and 50
     or p_offset is null or p_offset not between 0 and 10000 then
    raise exception 'Invalid MCP pagination' using errcode = '22023';
  end if;
  return query
    select i.id, i.project_id, i.issue_number, i.title, i.status, i.priority
    from public.resolve_mcp_connection(p_token_hash) a
    join public.issues i on i.project_id = a.project_id
    where p_status is null or i.status = p_status
    order by i.issue_number asc, i.id asc
    limit p_limit offset p_offset;
end;
$$;

create function public.mcp_get_issue(p_token_hash text, p_issue_id uuid)
returns table (
  id uuid, project_id uuid, issue_number integer, title text,
  description text, status public.issue_status, priority public.issue_priority
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select i.id, i.project_id, i.issue_number, i.title,
    coalesce(i.description, ''), i.status, i.priority
  from public.resolve_mcp_connection(p_token_hash) a
  join public.issues i on i.project_id = a.project_id
  where i.id = p_issue_id
  limit 1;
$$;

-- Row limits do not bound stored text lengths. The future Edge read adapter
-- must enforce response-byte limits and the existing MCP tool result limit;
-- these RPCs deliberately preserve full text rather than silently truncate it.
-- Issue list pages contain no description or full-count query. A full page is
-- only a possible next page; a following request can legitimately be empty.

-- Revoke defaults explicitly, including inherited PUBLIC execution. The
-- service_role credential is server-only; it is never an agent credential.
revoke all on function public.issue_mcp_connection_token(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.revoke_mcp_connection(uuid) from public, anon, authenticated, service_role;
revoke all on function public.resolve_mcp_connection(text) from public, anon, authenticated, service_role;
revoke all on function public.mcp_list_projects(text) from public, anon, authenticated, service_role;
revoke all on function public.mcp_list_issues(text, integer, integer, public.issue_status) from public, anon, authenticated, service_role;
revoke all on function public.mcp_get_issue(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.issue_mcp_connection_token(uuid, uuid, text) to authenticated;
grant execute on function public.revoke_mcp_connection(uuid) to authenticated;
grant execute on function public.resolve_mcp_connection(text) to service_role;
grant execute on function public.mcp_list_projects(text) to service_role;
grant execute on function public.mcp_list_issues(text, integer, integer, public.issue_status) to service_role;
grant execute on function public.mcp_get_issue(text, uuid) to service_role;

-- DEFERRED EDGE / FUNCTION CONTRACTS (not implemented by this migration):
--
-- 1. Human connection management:
--    Call issue_mcp_connection_token from the Owner's existing Supabase Auth
--    session. Show the returned token ONCE for secure IDE storage; never persist
--    the plaintext in TrackQA, logs, URLs or browser storage. Never grant direct
--    hash/approval writes. Rotation means revoke and issue a NEW connection;
--    there is no un-revoke or token recovery. Null principal references retain
--    deletion history only; such rows can never authorize access.
--
-- 2. MCP submission/read:
--    Require HTTPS and exactly one Authorization: Bearer tqm_<64 lowercase hex>
--    value, hash the complete token with SHA-256 and call resolve_mcp_connection
--    using the trusted Edge backend. Deny zero results and errors identically;
--    never accept a hash, connection ID, browser JWT or service key as the MCP
--    bearer credential. Never cache positive authorization across requests.
--    Keep the service-role key entirely server-side, used only for explicit
--    checked operations; never expose a generic database/RPC proxy to agents.
--    Rate-limit failed validation without logging tokens or their hashes.
--    A supplied connection_id, user_id, project_id, role or caller-set session
--    variable must NEVER serve as proof of authentication.
--    Recheck/lock project, connection and relevant membership state: enabled,
--    not archived, not revoked, both principal references present, linked user
--    still a member and token unexpired. The resolver is an authorization
--    snapshot, not a data-access capability: each future data RPC must repeat
--    the checks in the SAME operation that reads/writes data. Already-running
--    operations are not retroactively cancelled by revocation.
--    Derive provenance from that connection. Accept only the bounded report
--    fields; force PENDING and empty review/issue fields. For retries, the same
--    connection/submission ID returns the same finding only for identical report
--    content; reject changed content. Do not create issues or verification rows.
--
-- 3. Human review:
--    Require authenticated human browser context (not MCP credential context),
--    current QA/OWNER membership and a non-archived project. Lock the finding,
--    project and relevant membership state; accept only a PENDING finding.
--    Human review can finish after MCP disable/revocation. Rejection records
--    reviewer/time/note without an issue. Confirmation creates ONE normal issue
--    in the finding's project using human-reviewed fields and the existing
--    insertion/role/deadline/activity triggers, then sets reviewer/time/issue_id
--    and CONFIRMED in the SAME transaction. The human becomes the original
--    reporter and retains the existing reporter-based QA responsibility. Never
--    pre-set PASSED/FAILED or bypass qa_verify_issue. A repeated decision must
--    not create a second issue; terminal/deleted-result history stays terminal.
--
-- The Edge bearer authorizer is implemented separately. The three read RPCs
-- above are not yet connected to the Edge tools; the read adapter is deferred.
-- Opaque-token v1 requires IDE support for a configured Authorization header;
-- it is not automatic OAuth discovery and is not compatible with OAuth-only
-- clients. No OAuth settings, Auth hooks or browser JWT permissions are changed.

notify pgrst, 'reload schema';
commit;
