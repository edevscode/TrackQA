-- Date-only targets use one project timezone. Existing issues remain unscheduled.
alter table public.projects add column timezone text not null default 'Asia/Manila';
alter table public.issues
  add column resolve_by date,
  add column start_by date,
  add column ready_for_qa_by date,
  add column qa_decision_by date,
  add column deadline_timezone text not null default 'Asia/Manila',
  add column work_cycle integer not null default 1 check (work_cycle > 0),
  add column work_started_at timestamptz,
  add column ready_for_qa_at timestamptz,
  add column qa_decided_at timestamptz,
  add column completed_at timestamptz;

alter table public.issues add constraint issue_deadlines_ordered check (
  coalesce(start_by <= ready_for_qa_by, true)
  and coalesce(start_by <= qa_decision_by, true)
  and coalesce(start_by <= resolve_by, true)
  and coalesce(ready_for_qa_by <= qa_decision_by, true)
  and coalesce(ready_for_qa_by <= resolve_by, true)
  and coalesce(qa_decision_by <= resolve_by, true)
);
alter table public.issues add constraint issue_deadlines_supported_dates check (
  coalesce(start_by between date '0001-01-01' and date '9999-12-31', true)
  and coalesce(ready_for_qa_by between date '0001-01-01' and date '9999-12-31', true)
  and coalesce(qa_decision_by between date '0001-01-01' and date '9999-12-31', true)
  and coalesce(resolve_by between date '0001-01-01' and date '9999-12-31', true)
);
create index issues_resolution_deadline on public.issues(project_id, resolve_by)
where status <> 'DONE' and resolve_by is not null;

create table public.issue_deadline_history (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.issues(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event text not null check (event in ('CREATED', 'TARGETS_CHANGED', 'MILESTONE_REACHED', 'REWORK_STARTED')),
  work_cycle integer not null,
  before_values jsonb,
  after_values jsonb not null,
  created_at timestamptz not null default now()
);
create index issue_deadline_history_issue on public.issue_deadline_history(issue_id, created_at);
alter table public.issue_deadline_history enable row level security;
revoke insert, update, delete on public.issue_deadline_history from public, anon, authenticated;
grant select on public.issue_deadline_history to authenticated;
create policy "issue_deadline_history_select_member" on public.issue_deadline_history
for select to authenticated using (exists (
  select 1 from public.issues i where i.id = issue_id and public.is_project_member(i.project_id)
));

create or replace function public.guard_project_deadline_timezone()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone)
     or not (new.timezone in ('UTC', 'GMT') or (
       new.timezone ~ '^[A-Za-z_+-]+/[A-Za-z0-9_+/-]+$'
       and new.timezone not like 'posix/%' and new.timezone not like 'right/%'
     )) then
    raise exception 'Choose a valid project timezone' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and new.timezone is distinct from old.timezone and exists (
    select 1 from public.issues where project_id = old.id
      and coalesce(resolve_by, start_by, ready_for_qa_by, qa_decision_by) is not null
  ) then
    raise exception 'Project timezone cannot change while issues have deadlines' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger trg_check_project_deadline_timezone before insert or update on public.projects
for each row execute function public.guard_project_deadline_timezone();

create or replace function public.guard_issue_deadlines()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_timezone text;
begin
  if tg_op = 'INSERT' then
    select timezone into v_timezone from public.projects where id = new.project_id for share;
    new.deadline_timezone := v_timezone;
    new.work_cycle := 1;
    new.work_started_at := null;
    new.ready_for_qa_at := null;
    new.qa_decided_at := null;
    new.completed_at := null;
    return new;
  end if;

  if row(new.deadline_timezone, new.work_cycle, new.work_started_at,
         new.ready_for_qa_at, new.qa_decided_at, new.completed_at)
     is distinct from
     row(old.deadline_timezone, old.work_cycle, old.work_started_at,
         old.ready_for_qa_at, old.qa_decided_at, old.completed_at) then
    raise exception 'Milestone timestamps, cycle, and deadline timezone are managed by the workflow'
      using errcode = '42501';
  end if;

  if row(new.resolve_by, new.start_by, new.ready_for_qa_by, new.qa_decision_by)
     is distinct from row(old.resolve_by, old.start_by, old.ready_for_qa_by, old.qa_decision_by) then
    if not public.is_project_owner(old.project_id) and old.reporter_id is distinct from auth.uid() then
      raise exception 'Only the project owner or original reporter can change deadlines' using errcode = '42501';
    end if;
    -- Serialize target writes with timezone changes. Older unscheduled issues
    -- adopt the current project timezone when their first target is assigned.
    select timezone into v_timezone from public.projects where id = old.project_id for share;
    new.deadline_timezone := v_timezone;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'IN_PROGRESS' then
      if old.status = 'FAILED' then
        new.work_cycle := old.work_cycle + 1;
        new.ready_for_qa_at := null;
        new.qa_decided_at := null;
      end if;
      new.work_started_at := now();
    elsif new.status = 'FOR_TESTING' then new.ready_for_qa_at := now();
    elsif new.status in ('PASSED', 'FAILED') then new.qa_decided_at := now();
    elsif new.status = 'DONE' then new.completed_at := now();
    end if;
  end if;
  return new;
end;
$$;
-- Validate protected fields before existing identity and workflow triggers.
create trigger trg_check_deadline_updates before insert or update on public.issues
for each row execute function public.guard_issue_deadlines();

create or replace function public.record_issue_deadline_history()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_before jsonb; v_after jsonb; v_event text;
begin
  v_after := jsonb_build_object(
    'resolve_by', new.resolve_by, 'start_by', new.start_by,
    'ready_for_qa_by', new.ready_for_qa_by, 'qa_decision_by', new.qa_decision_by,
    'timezone', new.deadline_timezone, 'status', new.status, 'work_cycle', new.work_cycle,
    'work_started_at', new.work_started_at, 'ready_for_qa_at', new.ready_for_qa_at,
    'qa_decided_at', new.qa_decided_at, 'completed_at', new.completed_at
  );
  if tg_op = 'INSERT' then v_event := 'CREATED';
  else
    v_before := jsonb_build_object(
      'resolve_by', old.resolve_by, 'start_by', old.start_by,
      'ready_for_qa_by', old.ready_for_qa_by, 'qa_decision_by', old.qa_decision_by,
      'timezone', old.deadline_timezone, 'status', old.status, 'work_cycle', old.work_cycle,
      'work_started_at', old.work_started_at, 'ready_for_qa_at', old.ready_for_qa_at,
      'qa_decided_at', old.qa_decided_at, 'completed_at', old.completed_at
    );
    if v_before = v_after then return new; end if;
    v_event := case when new.work_cycle <> old.work_cycle then 'REWORK_STARTED'
      when new.status <> old.status then 'MILESTONE_REACHED' else 'TARGETS_CHANGED' end;
  end if;
  insert into public.issue_deadline_history(issue_id, actor_id, event, work_cycle, before_values, after_values)
  values(new.id, auth.uid(), v_event, new.work_cycle, v_before, v_after);
  return new;
end;
$$;
create trigger trg_record_issue_deadline_history after insert or update on public.issues
for each row execute function public.record_issue_deadline_history();

-- A missed stage can be pending or completed late. Final overdue counts only
-- unresolved issues; completed-late issues retain a separate historical flag.
create or replace view public.v_issue_deadlines with (security_invoker = true) as
select i.*,
  (i.status <> 'DONE' and i.resolve_by < (now() at time zone i.deadline_timezone)::date) is true as is_overdue,
  (i.status = 'DONE' and (i.completed_at at time zone i.deadline_timezone)::date > i.resolve_by) as completed_late,
  (
    ((i.work_started_at is not null or i.status = 'OPEN') and i.start_by < coalesce((i.work_started_at at time zone i.deadline_timezone)::date, (now() at time zone i.deadline_timezone)::date))
    or ((i.ready_for_qa_at is not null or i.status in ('OPEN', 'IN_PROGRESS')) and i.ready_for_qa_by < coalesce((i.ready_for_qa_at at time zone i.deadline_timezone)::date, (now() at time zone i.deadline_timezone)::date))
    or ((i.qa_decided_at is not null or i.status in ('OPEN', 'IN_PROGRESS', 'FOR_TESTING')) and i.qa_decision_by < coalesce((i.qa_decided_at at time zone i.deadline_timezone)::date, (now() at time zone i.deadline_timezone)::date))
  ) is true as has_missed_target,
  case when i.status <> 'DONE' then i.resolve_by end as resolution_sort_date
from public.issues i;
grant select on public.v_issue_deadlines to authenticated;

create or replace view public.v_project_dashboard_stats with (security_invoker = true) as
select project_id,
  count(*) filter (where status = 'OPEN') as open_issues,
  count(*) filter (where status = 'IN_PROGRESS') as in_progress_issues,
  count(*) filter (where status = 'FOR_TESTING') as for_testing_issues,
  count(*) filter (where status = 'PASSED') as passed_issues,
  count(*) filter (where status = 'FAILED') as failed_issues,
  count(*) filter (where status = 'DONE') as done_issues,
  count(*) filter (where status = 'DONE' and updated_at >= date_trunc('week', now())) as completed_this_week,
  count(*) filter (where is_overdue) as overdue_issues,
  count(*) filter (where status <> 'DONE' and has_missed_target) as missed_target_issues
from public.v_issue_deadlines group by project_id;

notify pgrst, 'reload schema';
