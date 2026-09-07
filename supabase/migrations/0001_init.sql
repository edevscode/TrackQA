-- =============================================================================
-- TrackQA — Initial database schema
-- Target: Supabase Postgres (PG15+). Paste into the Supabase SQL Editor.
--
-- Execution order (matches dependency graph):
--   Extensions -> Enums -> Tables -> Indexes -> Functions -> Triggers
--   -> RLS + Policies -> Grants -> Views -> Storage buckets + policies
--
-- Idempotency notes:
--   - Tables/indexes use IF NOT EXISTS.
--   - Enum types use a DO block that swallows "already exists" so the script
--     is safe to re-run during development.
--   - Functions use CREATE OR REPLACE (naturally idempotent).
--   - Triggers/policies are DROP IF EXISTS'd before being (re)created.
--   - Storage bucket inserts use ON CONFLICT DO NOTHING.
--   This script is NOT meant to be run twice against two different schema
--   versions — it's a single "run once, re-run safely while iterating" unit.
-- =============================================================================


-- =============================================================================
-- 0. EXTENSIONS
-- =============================================================================

create extension if not exists pgcrypto;


-- =============================================================================
-- 1. ENUMS
-- =============================================================================

do $$ begin
  create type project_role as enum ('OWNER', 'DEVELOPER', 'QA');
exception when duplicate_object then null; end $$;

do $$ begin
  create type invitation_status as enum ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type issue_priority as enum ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type issue_status as enum ('OPEN', 'IN_PROGRESS', 'FOR_TESTING', 'PASSED', 'FAILED', 'DONE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type qa_result as enum ('PASSED', 'FAILED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type activity_action as enum (
    'CREATED', 'ASSIGNED', 'REASSIGNED', 'PRIORITY_CHANGED', 'STATUS_CHANGED',
    'SUBMITTED_FOR_TESTING', 'QA_PASSED', 'QA_FAILED', 'MARKED_DONE', 'COMMENT_ADDED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type notification_type as enum (
    'ISSUE_ASSIGNED', 'READY_FOR_TESTING', 'QA_PASSED', 'QA_FAILED',
    'ISSUE_DONE', 'COMMENT_ADDED', 'INVITATION'
  );
exception when duplicate_object then null; end $$;


-- =============================================================================
-- 2. TABLES
-- =============================================================================

-- One row per auth.users row. Source of truth for email is auth.users; this
-- column is mirrored here (read-mostly) so the app can join/display it without
-- needing service-role access to the auth schema. See trg_prevent_profile_email_override.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- owner_id uses ON DELETE RESTRICT: a user cannot be deleted while they still
-- own a project. This guarantees "every project has an owner" holds even
-- across user deletion, at the cost of requiring ownership transfer/project
-- deletion first. See Part A for the full rationale.
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key text not null unique check (key ~ '^[A-Z][A-Z0-9]{1,9}$'),
  description text,
  owner_id uuid not null references public.profiles (id) on delete restrict,
  issue_seq integer not null default 0,
  archived boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role project_role not null default 'DEVELOPER',
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create table if not exists public.project_invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  email text not null,
  role project_role not null default 'DEVELOPER',
  status invitation_status not null default 'PENDING',
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  expires_at timestamptz not null default (now() + interval '14 days')
);

-- Only one PENDING invitation per (project, email) at a time.
create unique index if not exists ux_project_invitations_pending
  on public.project_invitations (project_id, email)
  where status = 'PENDING';

create table if not exists public.issues (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  issue_number integer not null,
  title text not null,
  description text,
  steps_to_reproduce text,
  expected_result text,
  actual_result text,
  environment_device text,
  environment_browser text,
  environment_app_version text,
  priority issue_priority not null default 'MEDIUM',
  status issue_status not null default 'OPEN',
  reporter_id uuid references public.profiles (id) on delete set null,
  assignee_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, issue_number)
);

-- Append-only. A new row per QA pass/fail cycle so earlier verifications
-- survive a FAILED -> IN_PROGRESS -> FOR_TESTING -> (re-verify) loop.
create table if not exists public.qa_verifications (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues (id) on delete cascade,
  qa_user_id uuid references public.profiles (id) on delete set null,
  result qa_result not null,
  comment text,
  failure_reason text,
  verified_at timestamptz not null default now()
);

-- Evidence (screenshots, recordings, logs) attached to one specific QA
-- verification attempt, so it stays scoped to the pass/fail cycle it
-- documents rather than piling up untagged on the issue as a whole.
create table if not exists public.qa_verification_attachments (
  id uuid primary key default gen_random_uuid(),
  qa_verification_id uuid not null references public.qa_verifications (id) on delete cascade,
  uploaded_by uuid references public.profiles (id) on delete set null,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size_bytes integer,
  created_at timestamptz not null default now()
);

create table if not exists public.issue_comments (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Binary files live in Supabase Storage (bucket "issue-attachments"); this
-- table is metadata only. storage_path is the object key within that bucket,
-- e.g. "{project_id}/{issue_id}/{uuid}-{file_name}".
create table if not exists public.issue_attachments (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues (id) on delete cascade,
  uploaded_by uuid references public.profiles (id) on delete set null,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size_bytes bigint,
  created_at timestamptz not null default now()
);

-- Append-only, system-written (see log_issue_activity / log_comment_activity).
create table if not exists public.issue_activity (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  action activity_action not null,
  from_value text,
  to_value text,
  note text,
  created_at timestamptz not null default now()
);

-- System-written (see create_notification). Users can only read/mark-read/
-- delete their own rows.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  type notification_type not null,
  title text not null,
  message text,
  project_id uuid references public.projects (id) on delete cascade,
  issue_id uuid references public.issues (id) on delete cascade,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- Account-level (not per-project) toggles shown on the Account Settings page.
create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  email_on_issue_assigned boolean not null default true,
  daily_digest boolean not null default false,
  updated_at timestamptz not null default now()
);


-- =============================================================================
-- 3. INDEXES
-- =============================================================================

create index if not exists idx_project_members_user on public.project_members (user_id);
create index if not exists idx_project_invitations_email on public.project_invitations (email);
create index if not exists idx_issues_project_status on public.issues (project_id, status);
create index if not exists idx_issues_assignee on public.issues (assignee_id);
create index if not exists idx_issues_reporter on public.issues (reporter_id);
create index if not exists idx_qa_verifications_issue on public.qa_verifications (issue_id);
create index if not exists idx_qa_verification_attachments_verification on public.qa_verification_attachments (qa_verification_id);
create index if not exists idx_issue_comments_issue on public.issue_comments (issue_id);
create index if not exists idx_issue_attachments_issue on public.issue_attachments (issue_id);
create index if not exists idx_issue_activity_issue on public.issue_activity (issue_id);
create index if not exists idx_notifications_recipient_unread on public.notifications (recipient_id, is_read);


-- =============================================================================
-- 4. FUNCTIONS
-- =============================================================================

-- ---- Generic helpers ----------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Membership helpers are SECURITY DEFINER so they can read project_members
-- without going through project_members' own RLS policy (which itself calls
-- these functions) — this is what avoids infinite RLS recursion. They only
-- ever return a boolean/enum, never raw rows, so they don't leak table data.
create or replace function public.is_project_member(p_project_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = p_user_id
  );
$$;

create or replace function public.get_project_role(p_project_id uuid, p_user_id uuid default auth.uid())
returns project_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.project_members
  where project_id = p_project_id and user_id = p_user_id;
$$;

create or replace function public.is_project_owner(p_project_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.project_members
    where project_id = p_project_id and user_id = p_user_id and role = 'OWNER'
  );
$$;

-- ---- auth.users integration ----------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles
    set email = new.email, updated_at = now()
    where id = new.id;
  end if;
  return new;
end;
$$;

-- auth.users is the sole source of truth for email; block any attempt to
-- change profiles.email through a normal client UPDATE (see Part A, section 18).
create or replace function public.prevent_profile_email_override()
returns trigger
language plpgsql
as $$
begin
  new.email := old.email;
  new.updated_at := now();
  return new;
end;
$$;

-- ---- projects --------------------------------------------------------------

create or replace function public.before_project_insert()
returns trigger
language plpgsql
as $$
begin
  new.key := upper(new.key);
  return new;
end;
$$;

-- "Key cannot be changed after creation" (also stated in the Project Settings
-- UI) is enforced here, not just in the frontend.
create or replace function public.before_project_update()
returns trigger
language plpgsql
as $$
begin
  if new.key is distinct from old.key then
    raise exception 'Project key cannot be changed after creation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.prevent_last_owner_removal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_owner_count integer;
begin
  v_project_id := coalesce(old.project_id, new.project_id);

  if (tg_op = 'DELETE' and old.role = 'OWNER')
     or (tg_op = 'UPDATE' and old.role = 'OWNER' and new.role is distinct from 'OWNER') then
    select count(*) into v_owner_count
    from public.project_members
    where project_id = v_project_id and role = 'OWNER';

    if v_owner_count <= 1 then
      raise exception 'A project must have at least one OWNER';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Normalizes email case here too (not just in invite_member) so a direct
-- INSERT by the project owner can't create a case-variant duplicate that
-- slips past ux_project_invitations_pending.
create or replace function public.before_project_invitation_insert()
returns trigger
language plpgsql
as $$
begin
  new.email := lower(new.email);
  return new;
end;
$$;

-- ---- issues: creation invariants -------------------------------------------

-- Forces status=OPEN and reporter=caller regardless of client input, and
-- assigns a per-project sequential issue_number (e.g. TQA-843) by atomically
-- incrementing projects.issue_seq (the row lock from the UPDATE makes this
-- safe under concurrent inserts). Runs SECURITY DEFINER because a DEVELOPER/QA
-- member creating an issue does not otherwise have UPDATE rights on projects.
create or replace function public.before_issue_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_next_number integer;
begin
  new.status := 'OPEN';
  new.reporter_id := auth.uid();

  update public.projects
  set issue_seq = issue_seq + 1
  where id = new.project_id
  returning issue_seq into v_next_number;

  if v_next_number is null then
    raise exception 'Project % does not exist', new.project_id;
  end if;

  new.issue_number := v_next_number;
  return new;
end;
$$;

-- ---- issues: workflow state machine ----------------------------------------
--
--   OPEN -> IN_PROGRESS         (OWNER, or DEVELOPER if they're the assignee)
--   IN_PROGRESS -> FOR_TESTING  (OWNER, or DEVELOPER if they're the assignee)
--   FOR_TESTING -> PASSED       (OWNER or QA)
--   FOR_TESTING -> FAILED       (OWNER or QA)
--   FAILED -> IN_PROGRESS       (OWNER, or DEVELOPER if they're the assignee)
--   PASSED -> DONE              (OWNER only)
--
-- Once an issue is DONE it is fully frozen: no further updates of any kind
-- (status, priority, assignee, or otherwise) are accepted, for any role.
--
-- Any other from->to pair is rejected. This is enforced at the database level
-- (not just the frontend) so a direct API/SQL call can't skip steps or have
-- the wrong role perform a QA-only action.
-- Also gates priority/assignee edits (owner-only), not just status
-- transitions, despite the name — renaming would mean re-wiring the trigger.
create or replace function public.enforce_issue_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role project_role;
begin
  if old.status = 'DONE' then
    raise exception 'This issue is done and can no longer be edited';
  end if;

  v_role := public.get_project_role(new.project_id, auth.uid());

  if new.priority is distinct from old.priority or new.assignee_id is distinct from old.assignee_id then
    if v_role is distinct from 'OWNER'::project_role then
      raise exception 'Only the project owner can change priority or reassign this issue';
    end if;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if v_role is null then
    raise exception 'Only project members can change issue status';
  end if;

  if old.status = 'OPEN' and new.status = 'IN_PROGRESS' then
    if v_role = 'OWNER' then
      null;
    elsif v_role = 'DEVELOPER' and new.assignee_id = (select auth.uid()) then
      null;
    else
      raise exception 'Only the project owner or the assigned developer can start work on this issue';
    end if;

  elsif old.status = 'IN_PROGRESS' and new.status = 'FOR_TESTING' then
    if v_role = 'OWNER' then
      null;
    elsif v_role = 'DEVELOPER' and new.assignee_id = (select auth.uid()) then
      null;
    else
      raise exception 'Only the project owner or the assigned developer can submit this issue for testing';
    end if;

  elsif old.status = 'FOR_TESTING' and new.status in ('PASSED', 'FAILED') then
    if v_role not in ('OWNER', 'QA') then
      raise exception 'Only an OWNER or QA member can record a QA result';
    end if;

  elsif old.status = 'FAILED' and new.status = 'IN_PROGRESS' then
    if v_role = 'OWNER' then
      null;
    elsif v_role = 'DEVELOPER' and new.assignee_id = (select auth.uid()) then
      null;
    else
      raise exception 'Only the project owner or the assigned developer can resume work on this issue';
    end if;

  elsif old.status = 'PASSED' and new.status = 'DONE' then
    if v_role is distinct from 'OWNER'::project_role then
      raise exception 'Only the project owner can close a passed issue';
    end if;

  else
    raise exception 'Invalid issue status transition: % -> %', old.status, new.status;
  end if;

  return new;
end;
$$;

-- ---- activity log (system-written) -----------------------------------------

create or replace function public.log_issue_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.issue_activity (issue_id, actor_id, action, from_value, to_value)
    values (new.id, new.reporter_id, 'CREATED', null, new.status::text);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.issue_activity (issue_id, actor_id, action, from_value, to_value)
    values (
      new.id, auth.uid(),
      case
        when new.status = 'FOR_TESTING' then 'SUBMITTED_FOR_TESTING'::activity_action
        when new.status = 'PASSED' then 'QA_PASSED'::activity_action
        when new.status = 'FAILED' then 'QA_FAILED'::activity_action
        when new.status = 'DONE' then 'MARKED_DONE'::activity_action
        else 'STATUS_CHANGED'::activity_action
      end,
      old.status::text, new.status::text
    );
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    insert into public.issue_activity (issue_id, actor_id, action, from_value, to_value)
    values (
      new.id, auth.uid(),
      case when old.assignee_id is null then 'ASSIGNED'::activity_action else 'REASSIGNED'::activity_action end,
      old.assignee_id::text, new.assignee_id::text
    );
  end if;

  if new.priority is distinct from old.priority then
    insert into public.issue_activity (issue_id, actor_id, action, from_value, to_value)
    values (new.id, auth.uid(), 'PRIORITY_CHANGED', old.priority::text, new.priority::text);
  end if;

  return new;
end;
$$;

create or replace function public.log_comment_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.issue_activity (issue_id, actor_id, action, note)
  values (new.issue_id, new.author_id, 'COMMENT_ADDED', left(new.content, 140));
  return new;
end;
$$;

-- ---- notifications (system-written) ----------------------------------------
--
-- NOT exposed to clients as an RPC (see the REVOKE statements below) — a
-- direct-callable create_notification would let any authenticated user spoof
-- notifications to/from anyone.
create or replace function public.create_notification(
  p_recipient_id uuid,
  p_actor_id uuid,
  p_type notification_type,
  p_title text,
  p_message text,
  p_project_id uuid,
  p_issue_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_recipient_id is null or p_recipient_id = p_actor_id then
    return; -- no recipient, or don't notify users about their own action
  end if;

  insert into public.notifications (recipient_id, actor_id, type, title, message, project_id, issue_id)
  values (p_recipient_id, p_actor_id, p_type, p_title, p_message, p_project_id, p_issue_id);
end;
$$;

create or replace function public.notify_issue_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_member record;
begin
  if new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null then
    perform public.create_notification(
      new.assignee_id, v_actor, 'ISSUE_ASSIGNED',
      format('Issue #%s assigned to you', new.issue_number),
      new.title, new.project_id, new.id
    );
  end if;

  if new.status is distinct from old.status then
    if new.status = 'FOR_TESTING' then
      for v_member in
        select user_id from public.project_members
        where project_id = new.project_id and role in ('QA', 'OWNER') and user_id <> v_actor
      loop
        perform public.create_notification(
          v_member.user_id, v_actor, 'READY_FOR_TESTING',
          format('Issue #%s is ready for testing', new.issue_number),
          new.title, new.project_id, new.id
        );
      end loop;

    elsif new.status = 'PASSED' then
      perform public.create_notification(
        new.reporter_id, v_actor, 'QA_PASSED',
        format('Issue #%s passed QA', new.issue_number), new.title, new.project_id, new.id
      );
      perform public.create_notification(
        new.assignee_id, v_actor, 'QA_PASSED',
        format('Issue #%s passed QA', new.issue_number), new.title, new.project_id, new.id
      );

    elsif new.status = 'FAILED' then
      perform public.create_notification(
        new.assignee_id, v_actor, 'QA_FAILED',
        format('Issue #%s failed QA verification', new.issue_number), new.title, new.project_id, new.id
      );

    elsif new.status = 'DONE' then
      perform public.create_notification(
        new.reporter_id, v_actor, 'ISSUE_DONE',
        format('Issue #%s was marked done', new.issue_number), new.title, new.project_id, new.id
      );
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.notify_new_comment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_issue public.issues%rowtype;
begin
  select * into v_issue from public.issues where id = new.issue_id;

  perform public.create_notification(
    v_issue.reporter_id, new.author_id, 'COMMENT_ADDED',
    format('New comment on issue #%s', v_issue.issue_number),
    new.content, v_issue.project_id, v_issue.id
  );

  if v_issue.assignee_id is distinct from v_issue.reporter_id then
    perform public.create_notification(
      v_issue.assignee_id, new.author_id, 'COMMENT_ADDED',
      format('New comment on issue #%s', v_issue.issue_number),
      new.content, v_issue.project_id, v_issue.id
    );
  end if;

  return new;
end;
$$;

-- ---- RPCs meant to be called directly by the frontend ----------------------

-- Atomically creates a project AND its OWNER membership row, so a project can
-- never exist without an owner (see Part A, section 19).
create or replace function public.create_project(
  p_name text,
  p_key text,
  p_description text default null
)
returns public.projects
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project public.projects;
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated to create a project';
  end if;

  insert into public.projects (name, key, description, owner_id)
  values (p_name, p_key, p_description, auth.uid())
  returning * into v_project;

  insert into public.project_members (project_id, user_id, role)
  values (v_project.id, auth.uid(), 'OWNER');

  return v_project;
end;
$$;

create or replace function public.invite_member(
  p_project_id uuid,
  p_email text,
  p_role project_role default 'DEVELOPER'
)
returns public.project_invitations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invitation public.project_invitations;
begin
  if not public.is_project_owner(p_project_id) then
    raise exception 'Only the project owner can invite members';
  end if;

  insert into public.project_invitations (project_id, email, role, invited_by)
  values (p_project_id, lower(p_email), p_role, auth.uid())
  returning * into v_invitation;

  return v_invitation;
end;
$$;

create or replace function public.accept_project_invitation(p_invitation_id uuid)
returns public.project_members
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invitation public.project_invitations;
  v_member public.project_members;
  v_email text;
begin
  select email into v_email from auth.users where id = auth.uid();

  select * into v_invitation
  from public.project_invitations
  where id = p_invitation_id
  for update;

  if v_invitation is null then
    raise exception 'Invitation not found';
  end if;

  if v_invitation.status <> 'PENDING' then
    raise exception 'Invitation is no longer pending';
  end if;

  if v_invitation.expires_at < now() then
    update public.project_invitations set status = 'EXPIRED' where id = p_invitation_id;
    raise exception 'Invitation has expired';
  end if;

  if lower(v_email) is distinct from v_invitation.email then
    raise exception 'This invitation was not sent to your account email';
  end if;

  insert into public.project_members (project_id, user_id, role)
  values (v_invitation.project_id, auth.uid(), v_invitation.role)
  on conflict (project_id, user_id) do update set role = excluded.role
  returning * into v_member;

  update public.project_invitations
  set status = 'ACCEPTED', responded_at = now()
  where id = p_invitation_id;

  return v_member;
end;
$$;

create or replace function public.decline_project_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text;
  v_invitation_email text;
begin
  select email into v_email from auth.users where id = auth.uid();
  select email into v_invitation_email from public.project_invitations where id = p_invitation_id;

  if v_invitation_email is null then
    raise exception 'Invitation not found';
  end if;

  if lower(v_email) is distinct from v_invitation_email then
    raise exception 'This invitation was not sent to your account email';
  end if;

  update public.project_invitations
  set status = 'DECLINED', responded_at = now()
  where id = p_invitation_id and status = 'PENDING';
end;
$$;

-- Bundles the QA verification row + the resulting status change into one
-- call. Deliberately SECURITY INVOKER (the default) — it relies entirely on
-- the normal RLS policies and enforce_issue_status_transition for permission
-- checks, so there is exactly one place (the trigger) that decides "who can
-- record a QA result." Returns the new qa_verifications.id (rather than the
-- issue row) so the client can attach evidence files to that specific
-- verification via qa_verification_attachments.
create or replace function public.qa_verify_issue(
  p_issue_id uuid,
  p_result qa_result,
  p_comment text default null,
  p_failure_reason text default null
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_verification_id uuid;
begin
  insert into public.qa_verifications (issue_id, qa_user_id, result, comment, failure_reason)
  values (p_issue_id, auth.uid(), p_result, p_comment, p_failure_reason)
  returning id into v_verification_id;

  update public.issues
  set status = case when p_result = 'PASSED' then 'PASSED'::issue_status else 'FAILED'::issue_status end
  where id = p_issue_id;

  return v_verification_id;
end;
$$;


-- =============================================================================
-- 5. TRIGGERS
-- =============================================================================

drop trigger if exists trg_handle_new_user on auth.users;
create trigger trg_handle_new_user
after insert on auth.users
for each row execute function public.handle_new_user();

drop trigger if exists trg_handle_user_email_change on auth.users;
create trigger trg_handle_user_email_change
after update of email on auth.users
for each row execute function public.handle_user_email_change();

drop trigger if exists trg_prevent_profile_email_override on public.profiles;
create trigger trg_prevent_profile_email_override
before update on public.profiles
for each row execute function public.prevent_profile_email_override();

drop trigger if exists trg_before_project_insert on public.projects;
create trigger trg_before_project_insert
before insert on public.projects
for each row execute function public.before_project_insert();

drop trigger if exists trg_before_project_update on public.projects;
create trigger trg_before_project_update
before update on public.projects
for each row execute function public.before_project_update();

drop trigger if exists trg_prevent_last_owner_removal on public.project_members;
create trigger trg_prevent_last_owner_removal
before update or delete on public.project_members
for each row execute function public.prevent_last_owner_removal();

drop trigger if exists trg_before_project_invitation_insert on public.project_invitations;
create trigger trg_before_project_invitation_insert
before insert on public.project_invitations
for each row execute function public.before_project_invitation_insert();

drop trigger if exists trg_before_issue_insert on public.issues;
create trigger trg_before_issue_insert
before insert on public.issues
for each row execute function public.before_issue_insert();

drop trigger if exists trg_enforce_issue_status_transition on public.issues;
create trigger trg_enforce_issue_status_transition
before update on public.issues
for each row execute function public.enforce_issue_status_transition();

drop trigger if exists trg_issues_set_updated_at on public.issues;
create trigger trg_issues_set_updated_at
before update on public.issues
for each row execute function public.set_updated_at();

drop trigger if exists trg_log_issue_activity_insert on public.issues;
create trigger trg_log_issue_activity_insert
after insert on public.issues
for each row execute function public.log_issue_activity();

drop trigger if exists trg_log_issue_activity_update on public.issues;
create trigger trg_log_issue_activity_update
after update on public.issues
for each row execute function public.log_issue_activity();

drop trigger if exists trg_notify_issue_changes on public.issues;
create trigger trg_notify_issue_changes
after update on public.issues
for each row execute function public.notify_issue_changes();

drop trigger if exists trg_issue_comments_set_updated_at on public.issue_comments;
create trigger trg_issue_comments_set_updated_at
before update on public.issue_comments
for each row execute function public.set_updated_at();

drop trigger if exists trg_log_comment_activity on public.issue_comments;
create trigger trg_log_comment_activity
after insert on public.issue_comments
for each row execute function public.log_comment_activity();

drop trigger if exists trg_notify_new_comment on public.issue_comments;
create trigger trg_notify_new_comment
after insert on public.issue_comments
for each row execute function public.notify_new_comment();

drop trigger if exists trg_notification_preferences_set_updated_at on public.notification_preferences;
create trigger trg_notification_preferences_set_updated_at
before update on public.notification_preferences
for each row execute function public.set_updated_at();


-- =============================================================================
-- 6. ROW LEVEL SECURITY
-- =============================================================================

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_invitations enable row level security;
alter table public.issues enable row level security;
alter table public.qa_verifications enable row level security;
alter table public.qa_verification_attachments enable row level security;
alter table public.issue_comments enable row level security;
alter table public.issue_attachments enable row level security;
alter table public.issue_activity enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;

-- ---- profiles ---------------------------------------------------------------
-- Any authenticated user can read any profile (needed to show assignee/
-- reporter/member names & avatars app-wide). Only self-update is allowed, and
-- the email column is pinned to auth.users via trg_prevent_profile_email_override.

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
on public.profiles for select
to authenticated
using (true);

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self"
on public.profiles for insert
to authenticated
with check (id = (select auth.uid()));

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
on public.profiles for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- ---- projects -----------------------------------------------------------

drop policy if exists "projects_select_member" on public.projects;
create policy "projects_select_member"
on public.projects for select
to authenticated
using (public.is_project_member(id));

drop policy if exists "projects_insert_owner" on public.projects;
create policy "projects_insert_owner"
on public.projects for insert
to authenticated
with check (owner_id = (select auth.uid()));

drop policy if exists "projects_update_owner" on public.projects;
create policy "projects_update_owner"
on public.projects for update
to authenticated
using (public.is_project_owner(id))
with check (public.is_project_owner(id));

drop policy if exists "projects_delete_owner" on public.projects;
create policy "projects_delete_owner"
on public.projects for delete
to authenticated
using (public.is_project_owner(id));

-- ---- project_members ------------------------------------------------------

drop policy if exists "project_members_select_member" on public.project_members;
create policy "project_members_select_member"
on public.project_members for select
to authenticated
using (public.is_project_member(project_id));

drop policy if exists "project_members_insert_owner" on public.project_members;
create policy "project_members_insert_owner"
on public.project_members for insert
to authenticated
with check (public.is_project_owner(project_id));

drop policy if exists "project_members_update_owner" on public.project_members;
create policy "project_members_update_owner"
on public.project_members for update
to authenticated
using (public.is_project_owner(project_id))
with check (public.is_project_owner(project_id));

drop policy if exists "project_members_delete_owner_or_self" on public.project_members;
create policy "project_members_delete_owner_or_self"
on public.project_members for delete
to authenticated
using (public.is_project_owner(project_id) or user_id = (select auth.uid()));

-- ---- project_invitations --------------------------------------------------

drop policy if exists "project_invitations_select" on public.project_invitations;
create policy "project_invitations_select"
on public.project_invitations for select
to authenticated
using (
  public.is_project_owner(project_id)
  or email = lower((select auth.jwt() ->> 'email'))
);

drop policy if exists "project_invitations_insert_owner" on public.project_invitations;
create policy "project_invitations_insert_owner"
on public.project_invitations for insert
to authenticated
with check (public.is_project_owner(project_id) and invited_by = (select auth.uid()));

drop policy if exists "project_invitations_update" on public.project_invitations;
create policy "project_invitations_update"
on public.project_invitations for update
to authenticated
using (
  public.is_project_owner(project_id)
  or email = lower((select auth.jwt() ->> 'email'))
)
with check (
  public.is_project_owner(project_id)
  or email = lower((select auth.jwt() ->> 'email'))
);

drop policy if exists "project_invitations_delete_owner" on public.project_invitations;
create policy "project_invitations_delete_owner"
on public.project_invitations for delete
to authenticated
using (public.is_project_owner(project_id));

-- ---- issues ---------------------------------------------------------------
-- General field edits (title/description/priority/assignee/etc.) are open to
-- any project member; the status column specifically is further gated by
-- trg_enforce_issue_status_transition regardless of what this policy allows.

drop policy if exists "issues_select_member" on public.issues;
create policy "issues_select_member"
on public.issues for select
to authenticated
using (public.is_project_member(project_id));

drop policy if exists "issues_insert_member" on public.issues;
create policy "issues_insert_member"
on public.issues for insert
to authenticated
with check (public.is_project_member(project_id));

drop policy if exists "issues_update_member" on public.issues;
create policy "issues_update_member"
on public.issues for update
to authenticated
using (public.is_project_member(project_id))
with check (public.is_project_member(project_id));

drop policy if exists "issues_delete_owner" on public.issues;
create policy "issues_delete_owner"
on public.issues for delete
to authenticated
using (public.is_project_owner(project_id));

-- ---- qa_verifications -------------------------------------------------------
-- Append-only: no update/delete policy, so history can never be edited or
-- destroyed, even by the QA user who created it.

drop policy if exists "qa_verifications_select_member" on public.qa_verifications;
create policy "qa_verifications_select_member"
on public.qa_verifications for select
to authenticated
using (
  exists (
    select 1 from public.issues i
    where i.id = qa_verifications.issue_id
      and public.is_project_member(i.project_id)
  )
);

drop policy if exists "qa_verifications_insert_qa_or_owner" on public.qa_verifications;
create policy "qa_verifications_insert_qa_or_owner"
on public.qa_verifications for insert
to authenticated
with check (
  qa_user_id = (select auth.uid())
  and exists (
    select 1 from public.issues i
    where i.id = qa_verifications.issue_id
      and public.get_project_role(i.project_id) in ('QA', 'OWNER')
  )
);

-- ---- qa_verification_attachments ---------------------------------------------
-- Evidence can only be added by whoever performed that specific verification
-- (qa_user_id = auth.uid()), not by any project member — it documents their
-- own pass/fail attempt. Deletable by the uploader or the project owner.

drop policy if exists "qa_verification_attachments_select_member" on public.qa_verification_attachments;
create policy "qa_verification_attachments_select_member"
on public.qa_verification_attachments for select
to authenticated
using (
  exists (
    select 1 from public.qa_verifications qv
    join public.issues i on i.id = qv.issue_id
    where qv.id = qa_verification_attachments.qa_verification_id
      and public.is_project_member(i.project_id)
  )
);

drop policy if exists "qa_verification_attachments_insert_verifier" on public.qa_verification_attachments;
create policy "qa_verification_attachments_insert_verifier"
on public.qa_verification_attachments for insert
to authenticated
with check (
  uploaded_by = (select auth.uid())
  and exists (
    select 1 from public.qa_verifications qv
    where qv.id = qa_verification_attachments.qa_verification_id
      and qv.qa_user_id = (select auth.uid())
  )
);

drop policy if exists "qa_verification_attachments_delete_uploader_or_owner" on public.qa_verification_attachments;
create policy "qa_verification_attachments_delete_uploader_or_owner"
on public.qa_verification_attachments for delete
to authenticated
using (
  uploaded_by = (select auth.uid())
  or exists (
    select 1 from public.qa_verifications qv
    join public.issues i on i.id = qv.issue_id
    where qv.id = qa_verification_attachments.qa_verification_id
      and public.is_project_owner(i.project_id)
  )
);

-- ---- issue_comments ---------------------------------------------------------

drop policy if exists "issue_comments_select_member" on public.issue_comments;
create policy "issue_comments_select_member"
on public.issue_comments for select
to authenticated
using (
  exists (
    select 1 from public.issues i
    where i.id = issue_comments.issue_id
      and public.is_project_member(i.project_id)
  )
);

-- A member's ability to comment/attach on an issue is scoped to how they
-- relate to it: the owner always can; the reporter always can (it's their
-- report); the assignee always can (it's their work); a QA member can while
-- the issue is actively in QA (FOR_TESTING/FAILED) or if they previously
-- verified it. Any other project member (e.g. a developer not assigned to
-- this particular issue) has read-only access to it via the shared backlog.
drop policy if exists "issue_comments_insert_member" on public.issue_comments;
create policy "issue_comments_insert_member"
on public.issue_comments for insert
to authenticated
with check (
  author_id = (select auth.uid())
  and exists (
    select 1 from public.issues i
    where i.id = issue_comments.issue_id
      and i.status <> 'DONE'
      and (
        public.get_project_role(i.project_id) = 'OWNER'
        or i.reporter_id = (select auth.uid())
        or i.assignee_id = (select auth.uid())
        or (
          public.get_project_role(i.project_id) = 'QA'
          and (
            i.status in ('FOR_TESTING', 'FAILED')
            or exists (
              select 1 from public.qa_verifications qv
              where qv.issue_id = i.id and qv.qa_user_id = (select auth.uid())
            )
          )
        )
      )
  )
);

drop policy if exists "issue_comments_update_author" on public.issue_comments;
create policy "issue_comments_update_author"
on public.issue_comments for update
to authenticated
using (
  author_id = (select auth.uid())
  and not exists (
    select 1 from public.issues i
    where i.id = issue_comments.issue_id
      and i.status = 'DONE'
  )
)
with check (author_id = (select auth.uid()));

drop policy if exists "issue_comments_delete_author_or_owner" on public.issue_comments;
create policy "issue_comments_delete_author_or_owner"
on public.issue_comments for delete
to authenticated
using (
  not exists (
    select 1 from public.issues i
    where i.id = issue_comments.issue_id
      and i.status = 'DONE'
  )
  and (
    author_id = (select auth.uid())
    or exists (
      select 1 from public.issues i
      where i.id = issue_comments.issue_id
        and public.is_project_owner(i.project_id)
    )
  )
);

-- ---- issue_attachments -------------------------------------------------------

drop policy if exists "issue_attachments_select_member" on public.issue_attachments;
create policy "issue_attachments_select_member"
on public.issue_attachments for select
to authenticated
using (
  exists (
    select 1 from public.issues i
    where i.id = issue_attachments.issue_id
      and public.is_project_member(i.project_id)
  )
);

-- Same "how does this member relate to the issue" scoping as
-- issue_comments_insert_member above.
drop policy if exists "issue_attachments_insert_member" on public.issue_attachments;
create policy "issue_attachments_insert_member"
on public.issue_attachments for insert
to authenticated
with check (
  uploaded_by = (select auth.uid())
  and exists (
    select 1 from public.issues i
    where i.id = issue_attachments.issue_id
      and i.status <> 'DONE'
      and (
        public.get_project_role(i.project_id) = 'OWNER'
        or i.reporter_id = (select auth.uid())
        or i.assignee_id = (select auth.uid())
        or (
          public.get_project_role(i.project_id) = 'QA'
          and (
            i.status in ('FOR_TESTING', 'FAILED')
            or exists (
              select 1 from public.qa_verifications qv
              where qv.issue_id = i.id and qv.qa_user_id = (select auth.uid())
            )
          )
        )
      )
  )
);

drop policy if exists "issue_attachments_delete_uploader_or_owner" on public.issue_attachments;
create policy "issue_attachments_delete_uploader_or_owner"
on public.issue_attachments for delete
to authenticated
using (
  not exists (
    select 1 from public.issues i
    where i.id = issue_attachments.issue_id
      and i.status = 'DONE'
  )
  and (
    uploaded_by = (select auth.uid())
    or exists (
      select 1 from public.issues i
      where i.id = issue_attachments.issue_id
        and public.is_project_owner(i.project_id)
    )
  )
);

-- ---- issue_activity -----------------------------------------------------------
-- Read-only from the client's perspective: no insert/update/delete policy, so
-- only the log_issue_activity/log_comment_activity triggers (running as the
-- table owner) can write rows.

drop policy if exists "issue_activity_select_member" on public.issue_activity;
create policy "issue_activity_select_member"
on public.issue_activity for select
to authenticated
using (
  exists (
    select 1 from public.issues i
    where i.id = issue_activity.issue_id
      and public.is_project_member(i.project_id)
  )
);

-- ---- notifications --------------------------------------------------------
-- No insert policy: only create_notification (SECURITY DEFINER, called from
-- triggers) can write rows — a client cannot insert or spoof a notification.

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
on public.notifications for select
to authenticated
using (recipient_id = (select auth.uid()));

drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
on public.notifications for update
to authenticated
using (recipient_id = (select auth.uid()))
with check (recipient_id = (select auth.uid()));

drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own"
on public.notifications for delete
to authenticated
using (recipient_id = (select auth.uid()));

-- ---- notification_preferences ----------------------------------------------

drop policy if exists "notification_preferences_select_own" on public.notification_preferences;
create policy "notification_preferences_select_own"
on public.notification_preferences for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "notification_preferences_insert_own" on public.notification_preferences;
create policy "notification_preferences_insert_own"
on public.notification_preferences for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "notification_preferences_update_own" on public.notification_preferences;
create policy "notification_preferences_update_own"
on public.notification_preferences for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));


-- =============================================================================
-- 7. GRANTS
-- =============================================================================
-- Postgres grants EXECUTE on new functions to PUBLIC by default, which is how
-- PostgREST exposes them as `/rest/v1/rpc/<name>` to any authenticated (or
-- even anon) caller. Trigger functions (return type "trigger") can't be
-- invoked directly and need no action. The two things that DO need tightening:
--
--   1. create_notification: a normal-return-type function that writes
--      notifications on someone else's behalf. Left public, any authenticated
--      user could spam arbitrary fake notifications. Revoked entirely.
--   2. is_project_member / get_project_role / is_project_owner: these must
--      stay EXECUTE-able by `authenticated` (RLS policies call them in the
--      querying user's own security context), but there's no reason for
--      anon to have them, so that grant is revoked. Note this still lets an
--      authenticated user probe *whether* some other user belongs to a given
--      project (a boolean, not their data) by passing an explicit p_user_id —
--      an accepted, minor tradeoff of this standard recursion-safe pattern.

revoke execute on function public.create_notification(uuid, uuid, notification_type, text, text, uuid, uuid) from public;

revoke execute on function public.is_project_member(uuid, uuid) from anon;
revoke execute on function public.get_project_role(uuid, uuid) from anon;
revoke execute on function public.is_project_owner(uuid, uuid) from anon;

revoke execute on function public.create_project(text, text, text) from anon;
revoke execute on function public.invite_member(uuid, text, project_role) from anon;
revoke execute on function public.accept_project_invitation(uuid) from anon;
revoke execute on function public.decline_project_invitation(uuid) from anon;
revoke execute on function public.qa_verify_issue(uuid, qa_result, text, text) from anon;


-- =============================================================================
-- 8. VIEWS (dashboard aggregation)
-- =============================================================================
-- security_invoker = true makes these views enforce RLS as the *querying*
-- user (via the underlying issues table's policies), not as the view owner.
-- Without it, a view's default is to run with the owner's (elevated)
-- privileges, which would silently defeat project isolation.

create or replace view public.v_project_dashboard_stats
with (security_invoker = true) as
select
  project_id,
  count(*) filter (where status = 'OPEN') as open_issues,
  count(*) filter (where status = 'IN_PROGRESS') as in_progress_issues,
  count(*) filter (where status = 'FOR_TESTING') as for_testing_issues,
  count(*) filter (where status = 'PASSED') as passed_issues,
  count(*) filter (where status = 'FAILED') as failed_issues,
  count(*) filter (where status = 'DONE') as done_issues,
  count(*) filter (where status = 'DONE' and updated_at >= date_trunc('week', now())) as completed_this_week
from public.issues
group by project_id;

create or replace view public.v_member_stats
with (security_invoker = true) as
select
  project_id,
  assignee_id as user_id,
  count(*) as assigned_issues,
  count(*) filter (where status = 'DONE') as completed_issues,
  count(*) filter (where status = 'IN_PROGRESS') as in_progress_issues,
  count(*) filter (where status = 'FOR_TESTING') as for_testing_issues
from public.issues
where assignee_id is not null
group by project_id, assignee_id;


-- =============================================================================
-- 9. STORAGE
-- =============================================================================
-- Two buckets:
--   avatars            — public read (profile pictures are low-sensitivity
--                         and commonly rendered without auth, e.g. in emails),
--                         write restricted to the owner's own folder.
--                         Path convention: {user_id}/{filename}
--   issue-attachments  — private, gated by project membership.
--                         Path convention: {project_id}/{issue_id}/{uuid}-{filename}

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('issue-attachments', 'issue-attachments', false)
on conflict (id) do nothing;

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
on storage.objects for select
to public
using (bucket_id = 'avatars');

drop policy if exists "avatars_owner_write" on storage.objects;
create policy "avatars_owner_write"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update"
on storage.objects for update
to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete"
on storage.objects for delete
to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "issue_attachments_member_read" on storage.objects;
create policy "issue_attachments_member_read"
on storage.objects for select
to authenticated
using (
  bucket_id = 'issue-attachments'
  and public.is_project_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "issue_attachments_member_write" on storage.objects;
create policy "issue_attachments_member_write"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'issue-attachments'
  and public.is_project_member(((storage.foldername(name))[1])::uuid)
);

drop policy if exists "issue_attachments_owner_delete" on storage.objects;
create policy "issue_attachments_owner_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'issue-attachments'
  and (owner = (select auth.uid()) or public.is_project_owner(((storage.foldername(name))[1])::uuid))
);


-- =============================================================================
-- 10. SEED DATA (optional, development only)
-- =============================================================================
-- Intentionally does NOT insert into auth.users — Supabase Auth owns that
-- table and inserting into it directly bypasses password hashing, email
-- confirmation, and other invariants Auth relies on. To get a real seed user,
-- sign up through the app (or Supabase Studio's Authentication tab, or
-- `supabase.auth.admin.createUser()` from a trusted server context); the
-- trg_handle_new_user trigger above will create their profile automatically.
--
-- Once you have at least one real auth user, you can seed a project as them:
--
--   select public.create_project('Phoenix App Redesign', 'PHX',
--     'Q3 redesign of the primary mobile application.');
--
-- Run that logged in as the seed user (e.g. via the Supabase JS client, or
-- SQL Editor's "Run as" if using a service-role session with request.jwt
-- claims set) — it must run with auth.uid() resolving to that user for the
-- ownership/membership rows to attach correctly. The production migration
-- above does not depend on any of this.
