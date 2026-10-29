begin;

-- Local date/time inputs retain the project timezone. Workflow-managed UTC
-- instants are authoritative for comparisons and sorting. NULL time means EOD.
create or replace function public.issue_deadline_cutoff(p_date date, p_time time, p_timezone text)
returns timestamptz language plpgsql immutable set search_path = public, pg_temp as $$
declare v_local timestamp; v_cutoff timestamptz; v_probe timestamptz; v_alternative timestamptz; v_offset interval;
begin
  if p_date is null then return null; end if;
  if p_date not between date '0001-01-01' and date '9999-12-31' then
    raise exception 'Choose a supported deadline date' using errcode = '23514';
  end if;
  if p_time is not null and (p_time >= time '24:00' or extract(second from p_time) <> 0) then
    raise exception 'Choose a deadline time using hours and minutes' using errcode = '22023';
  end if;
  if p_time is null then
    -- End of day is the last instant before the next local day begins,
    -- including dates where a clock change skips/repeats the final hour.
    v_local := (p_date + 1)::timestamp;
    v_cutoff := v_local at time zone p_timezone;
    foreach v_probe in array array[v_cutoff - interval '2 days', v_cutoff + interval '2 days'] loop
      v_offset := (v_probe at time zone p_timezone) - (v_probe at time zone 'UTC');
      v_alternative := (v_local at time zone 'UTC') - v_offset;
      if (v_alternative at time zone p_timezone) = v_local then v_cutoff := least(v_cutoff, v_alternative); end if;
    end loop;
    v_cutoff := v_cutoff - interval '1 microsecond';
    if (v_cutoff at time zone p_timezone)::date <> p_date then
      raise exception 'This calendar date does not exist in % due to a clock change', p_timezone using errcode = '22023';
    end if;
    return v_cutoff;
  end if;
  v_local := p_date + coalesce(p_time, time '23:59:59.999999');
  v_cutoff := v_local at time zone p_timezone;
  if (v_cutoff at time zone p_timezone) <> v_local then
    raise exception 'This local deadline time does not exist in % due to a clock change; choose another time', p_timezone
      using errcode = '22023';
  end if;
  -- Reject repeated wall-clock times instead of silently choosing one offset.
  foreach v_probe in array array[v_cutoff - interval '2 days', v_cutoff + interval '2 days'] loop
    v_offset := (v_probe at time zone p_timezone) - (v_probe at time zone 'UTC');
    v_alternative := (v_local at time zone 'UTC') - v_offset;
    if v_alternative <> v_cutoff and (v_alternative at time zone p_timezone) = v_local then
      raise exception 'This local deadline time occurs twice in % due to a clock change; choose an unambiguous time', p_timezone
        using errcode = '22023';
    end if;
  end loop;
  return v_cutoff;
end;
$$;

drop view public.v_project_dashboard_stats;
drop view public.v_issue_deadlines;
alter table public.issues
  add column deadline_mode text not null default 'none',
  add column start_time time,
  add column ready_for_qa_time time,
  add column qa_decision_time time,
  add column resolve_time time,
  add column start_cutoff_at timestamptz,
  add column ready_for_qa_cutoff_at timestamptz,
  add column qa_decision_cutoff_at timestamptz,
  add column resolve_cutoff_at timestamptz;

-- Metadata-only backfill under the ALTER TABLE transaction lock, including
-- frozen DONE issues. Preserve updated_at, completion timing, and old history.
alter table public.issues disable trigger trg_enforce_issue_status_transition;
alter table public.issues disable trigger trg_issues_set_updated_at;
alter table public.issues disable trigger trg_record_issue_deadline_history;
update public.issues set deadline_mode = case
  when coalesce(start_by, ready_for_qa_by, qa_decision_by) is not null then 'stages'
  when resolve_by is not null then 'single' else 'none' end,
  start_cutoff_at = public.issue_deadline_cutoff(start_by, start_time, deadline_timezone),
  ready_for_qa_cutoff_at = public.issue_deadline_cutoff(ready_for_qa_by, ready_for_qa_time, deadline_timezone),
  qa_decision_cutoff_at = public.issue_deadline_cutoff(qa_decision_by, qa_decision_time, deadline_timezone),
  resolve_cutoff_at = public.issue_deadline_cutoff(resolve_by, resolve_time, deadline_timezone);
alter table public.issues enable trigger trg_enforce_issue_status_transition;
alter table public.issues enable trigger trg_issues_set_updated_at;
alter table public.issues enable trigger trg_record_issue_deadline_history;

alter table public.issues add constraint issue_deadline_mode_valid check (
  (deadline_mode = 'none' and coalesce(start_by, ready_for_qa_by, qa_decision_by, resolve_by) is null)
  or (deadline_mode = 'single' and resolve_by is not null and coalesce(start_by, ready_for_qa_by, qa_decision_by) is null)
  or (deadline_mode = 'stages' and coalesce(start_by, ready_for_qa_by, qa_decision_by, resolve_by) is not null)
);
alter table public.issues add constraint issue_deadline_times_require_dates check (
  (start_time is null or start_by is not null)
  and (ready_for_qa_time is null or ready_for_qa_by is not null)
  and (qa_decision_time is null or qa_decision_by is not null)
  and (resolve_time is null or resolve_by is not null)
);
alter table public.issues add constraint issue_deadline_instants_ordered check (
  coalesce(start_cutoff_at <= ready_for_qa_cutoff_at, true)
  and coalesce(start_cutoff_at <= qa_decision_cutoff_at, true)
  and coalesce(start_cutoff_at <= resolve_cutoff_at, true)
  and coalesce(ready_for_qa_cutoff_at <= qa_decision_cutoff_at, true)
  and coalesce(ready_for_qa_cutoff_at <= resolve_cutoff_at, true)
  and coalesce(qa_decision_cutoff_at <= resolve_cutoff_at, true)
);
create index issues_resolution_cutoff on public.issues(project_id, resolve_cutoff_at)
where status <> 'DONE' and resolve_cutoff_at is not null;

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
    new.start_cutoff_at := public.issue_deadline_cutoff(new.start_by, new.start_time, new.deadline_timezone);
    new.ready_for_qa_cutoff_at := public.issue_deadline_cutoff(new.ready_for_qa_by, new.ready_for_qa_time, new.deadline_timezone);
    new.qa_decision_cutoff_at := public.issue_deadline_cutoff(new.qa_decision_by, new.qa_decision_time, new.deadline_timezone);
    new.resolve_cutoff_at := public.issue_deadline_cutoff(new.resolve_by, new.resolve_time, new.deadline_timezone);
    return new;
  end if;
  if row(new.deadline_timezone, new.work_cycle, new.work_started_at, new.ready_for_qa_at, new.qa_decided_at, new.completed_at,
         new.start_cutoff_at, new.ready_for_qa_cutoff_at, new.qa_decision_cutoff_at, new.resolve_cutoff_at)
     is distinct from row(old.deadline_timezone, old.work_cycle, old.work_started_at, old.ready_for_qa_at, old.qa_decided_at, old.completed_at,
         old.start_cutoff_at, old.ready_for_qa_cutoff_at, old.qa_decision_cutoff_at, old.resolve_cutoff_at) then
    raise exception 'Milestone timestamps, cycle, and deadline timezone are managed by the workflow' using errcode = '42501';
  end if;
  if row(new.deadline_mode, new.resolve_by, new.start_by, new.ready_for_qa_by, new.qa_decision_by,
         new.resolve_time, new.start_time, new.ready_for_qa_time, new.qa_decision_time)
     is distinct from row(old.deadline_mode, old.resolve_by, old.start_by, old.ready_for_qa_by, old.qa_decision_by,
         old.resolve_time, old.start_time, old.ready_for_qa_time, old.qa_decision_time) then
    if not public.is_project_owner(old.project_id) and old.reporter_id is distinct from auth.uid() then
      raise exception 'Only the project owner or original reporter can change deadline modes or targets' using errcode = '42501';
    end if;
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
  new.start_cutoff_at := public.issue_deadline_cutoff(new.start_by, new.start_time, new.deadline_timezone);
  new.ready_for_qa_cutoff_at := public.issue_deadline_cutoff(new.ready_for_qa_by, new.ready_for_qa_time, new.deadline_timezone);
  new.qa_decision_cutoff_at := public.issue_deadline_cutoff(new.qa_decision_by, new.qa_decision_time, new.deadline_timezone);
  new.resolve_cutoff_at := public.issue_deadline_cutoff(new.resolve_by, new.resolve_time, new.deadline_timezone);
  return new;
end;
$$;

create or replace function public.record_issue_deadline_history()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_before jsonb; v_after jsonb; v_event text;
begin
  -- Include mode, local times, and UTC cutoffs. Older JSON snapshots stay intact.
  select jsonb_object_agg(key, value) into v_after from jsonb_each(to_jsonb(new))
  where key in ('deadline_mode','resolve_by','start_by','ready_for_qa_by','qa_decision_by',
    'resolve_time','start_time','ready_for_qa_time','qa_decision_time',
    'resolve_cutoff_at','start_cutoff_at','ready_for_qa_cutoff_at','qa_decision_cutoff_at',
    'status','work_cycle','work_started_at','ready_for_qa_at','qa_decided_at','completed_at');
  v_after := v_after || jsonb_build_object('timezone', new.deadline_timezone);
  if tg_op = 'INSERT' then v_event := 'CREATED';
  else
    select jsonb_object_agg(key, value) into v_before from jsonb_each(to_jsonb(old))
    where key in ('deadline_mode','resolve_by','start_by','ready_for_qa_by','qa_decision_by',
      'resolve_time','start_time','ready_for_qa_time','qa_decision_time',
      'resolve_cutoff_at','start_cutoff_at','ready_for_qa_cutoff_at','qa_decision_cutoff_at',
      'status','work_cycle','work_started_at','ready_for_qa_at','qa_decided_at','completed_at');
    v_before := v_before || jsonb_build_object('timezone', old.deadline_timezone);
    if v_before = v_after then return new; end if;
    v_event := case when new.work_cycle <> old.work_cycle then 'REWORK_STARTED'
      when new.status <> old.status then 'MILESTONE_REACHED' else 'TARGETS_CHANGED' end;
  end if;
  insert into public.issue_deadline_history(issue_id, actor_id, event, work_cycle, before_values, after_values)
  values(new.id, auth.uid(), v_event, new.work_cycle, v_before, v_after);
  return new;
end;
$$;

create view public.v_issue_deadlines with (security_invoker = true) as
select i.*,
  (i.deadline_mode <> 'none' and i.status <> 'DONE' and i.resolve_cutoff_at < now()) is true as is_overdue,
  (i.deadline_mode <> 'none' and i.status = 'DONE' and i.completed_at > i.resolve_cutoff_at) as completed_late,
  (i.deadline_mode = 'stages' and (
    ((i.work_started_at is not null or i.status = 'OPEN') and i.start_cutoff_at < coalesce(i.work_started_at, now()))
    or ((i.ready_for_qa_at is not null or i.status in ('OPEN','IN_PROGRESS')) and i.ready_for_qa_cutoff_at < coalesce(i.ready_for_qa_at, now()))
    or ((i.qa_decided_at is not null or i.status in ('OPEN','IN_PROGRESS','FOR_TESTING')) and i.qa_decision_cutoff_at < coalesce(i.qa_decided_at, now()))
  )) is true as has_missed_target,
  case when i.deadline_mode <> 'none' and i.status <> 'DONE' then i.resolve_cutoff_at end as resolution_sort_date
from public.issues i;
grant select on public.v_issue_deadlines to authenticated;

create view public.v_project_dashboard_stats with (security_invoker = true) as
select project_id,
  count(*) filter (where status='OPEN') as open_issues,
  count(*) filter (where status='IN_PROGRESS') as in_progress_issues,
  count(*) filter (where status='FOR_TESTING') as for_testing_issues,
  count(*) filter (where status='PASSED') as passed_issues,
  count(*) filter (where status='FAILED') as failed_issues,
  count(*) filter (where status='DONE') as done_issues,
  count(*) filter (where status='DONE' and updated_at >= date_trunc('week', now())) as completed_this_week,
  count(*) filter (where is_overdue) as overdue_issues,
  count(*) filter (where status <> 'DONE' and has_missed_target) as missed_target_issues
from public.v_issue_deadlines group by project_id;
grant select on public.v_project_dashboard_stats to authenticated;
notify pgrst, 'reload schema';
commit;
