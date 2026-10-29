-- Runs in npm test's embedded PostgreSQL or a disposable Supabase database.
begin;
create temporary table deadline_fixture (
  owner_id uuid default gen_random_uuid(), reporter_id uuid default gen_random_uuid(),
  developer_id uuid default gen_random_uuid(), outsider_id uuid default gen_random_uuid(),
  project_id uuid default gen_random_uuid(), issue_id uuid default gen_random_uuid(),
  late_issue_id uuid default gen_random_uuid()
);
insert into deadline_fixture default values;
grant select on deadline_fixture to authenticated;
insert into auth.users(id, email)
select actor, actor::text || '@example.invalid' from deadline_fixture f
cross join lateral unnest(array[f.owner_id, f.reporter_id, f.developer_id, f.outsider_id]) actor;
insert into public.projects(id, name, key, owner_id)
select project_id, 'Deadline regression', 'T' || upper(substr(replace(project_id::text, '-', ''), 1, 8)), owner_id from deadline_fixture;
insert into public.project_members(project_id, user_id, role)
select f.project_id, actor, case when actor = f.owner_id then 'OWNER'::public.project_role when actor = f.reporter_id then 'QA'::public.project_role else 'DEVELOPER'::public.project_role end
from deadline_fixture f cross join lateral unnest(array[f.owner_id, f.reporter_id, f.developer_id]) actor;

create function pg_temp.expect_deadline_denied(statement text, expected_state text)
returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate = expected_state then return; end if;
    raise;
  end;
  raise exception 'Expected SQLSTATE % for %', expected_state, statement;
end;
$$;
select set_config('request.jwt.claims', json_build_object('sub', reporter_id, 'role', 'authenticated')::text, true) from deadline_fixture;
set local role authenticated;
do $$
declare
  f record; v_issue public.issues; v_day date := (now() at time zone 'Asia/Manila')::date;
  v_failed_history jsonb; v_count bigint;
begin
  select * into f from deadline_fixture;
  insert into public.issues(id, project_id, title, assignee_id, work_cycle, completed_at, deadline_timezone)
  values(f.issue_id, f.project_id, 'Deadline issue', f.developer_id, 99, now(), 'Asia/Manila');
  select * into v_issue from public.issues where id = f.issue_id;
  if v_issue.resolve_by is not null or v_issue.work_cycle <> 1 or v_issue.completed_at is not null then
    raise exception 'New issues must be optional and system timestamps must not be spoofable';
  end if;
  perform pg_temp.expect_deadline_denied(format(
    'update public.issues set start_by=%L, resolve_by=%L where id=%L', v_day+2, v_day, f.issue_id), '23514');
  perform pg_temp.expect_deadline_denied(format(
    'update public.issues set work_cycle=9 where id=%L', f.issue_id), '42501');
  perform pg_temp.expect_deadline_denied(format(
    'update public.issues set resolve_by=''infinity'' where id=%L', f.issue_id), '23514');

  update public.issues set deadline_mode='stages', start_by=v_day-1, ready_for_qa_by=v_day,
    qa_decision_by=v_day, resolve_by=v_day+1 where id=f.issue_id;
  if not exists (select 1 from public.issue_deadline_history where issue_id=f.issue_id
      and event='TARGETS_CHANGED' and actor_id=f.reporter_id
      and before_values->>'resolve_by' is null and after_values->>'resolve_by'=(v_day+1)::text) then
    raise exception 'Reporter deadline changes must record old/new values and actor';
  end if;
  insert into public.issues(id, project_id, title, assignee_id, deadline_mode, resolve_by, deadline_timezone)
  values(f.late_issue_id, f.project_id, 'Overdue issue', f.developer_id, 'single', v_day-1, 'Asia/Manila');
  if not exists(select 1 from public.v_issue_deadlines where id=f.late_issue_id and is_overdue)
     or not exists(select 1 from public.v_project_dashboard_stats where project_id=f.project_id and overdue_issues=1) then
    raise exception 'Overdue filters and dashboard count must match';
  end if;
  perform pg_temp.expect_deadline_denied(format(
    'insert into public.issue_deadline_history(issue_id, event, work_cycle, after_values) values(%L,''TARGETS_CHANGED'',1,''{}'')', f.issue_id), '42501');

  perform set_config('request.jwt.claims', json_build_object('sub',f.owner_id,'role','authenticated')::text, true);
  update public.issues set resolve_by=v_day+2 where id=f.issue_id;
  perform pg_temp.expect_deadline_denied(format(
    'update public.projects set timezone=''Invalid/Timezone'' where id=%L', f.project_id), '22023');
  update public.projects set timezone='UTC' where id=f.project_id;
  if not exists(select 1 from public.issues where id=f.issue_id and deadline_timezone='Asia/Manila' and resolve_timezone='Asia/Manila') then
    raise exception 'Project metadata must not reinterpret saved target timezones';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub',f.developer_id,'role','authenticated')::text, true);
  perform pg_temp.expect_deadline_denied(format(
    'update public.issues set resolve_by=null where id=%L', f.issue_id), '42501');
  update public.issues set status='IN_PROGRESS' where id=f.issue_id;
  update public.issues set status='FOR_TESTING' where id=f.issue_id;
  select * into v_issue from public.issues where id=f.issue_id;
  if v_issue.work_started_at is null or v_issue.ready_for_qa_at is null then
    raise exception 'Development transitions must stamp milestones';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub',f.reporter_id,'role','authenticated')::text, true);
  perform public.qa_verify_issue(f.issue_id,'FAILED',null,'Still reproduces');
  select after_values into v_failed_history from public.issue_deadline_history
  where issue_id=f.issue_id and event='MILESTONE_REACHED' and after_values->>'status'='FAILED';
  if v_failed_history->>'qa_decided_at' is null
     or not exists(select 1 from public.v_issue_deadlines where id=f.issue_id and has_missed_target and not is_overdue) then
    raise exception 'Failed QA must keep decision timing and separate stage misses from resolution overdue';
  end if;
  -- Rework does not silently extend targets or destroy the previous result.
  perform set_config('request.jwt.claims', json_build_object('sub',f.developer_id,'role','authenticated')::text, true);
  update public.issues set status='IN_PROGRESS' where id=f.issue_id;
  select * into v_issue from public.issues where id=f.issue_id;
  if v_issue.work_cycle<>2 or v_issue.start_by<>v_day-1 or v_issue.resolve_by<>v_day+2
     or v_issue.qa_decided_at is not null or v_issue.ready_for_qa_at is not null then
    raise exception 'Rework must start a new measured cycle while retaining targets';
  end if;
  if not exists(select 1 from public.issue_deadline_history where issue_id=f.issue_id
      and event='REWORK_STARTED' and before_values=v_failed_history) then
    raise exception 'Previous QA cycle snapshot must survive rework';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub',f.reporter_id,'role','authenticated')::text, true);
  update public.issues set start_by=v_day, ready_for_qa_by=v_day, qa_decision_by=v_day where id=f.issue_id;
  perform set_config('request.jwt.claims', json_build_object('sub',f.developer_id,'role','authenticated')::text, true);
  update public.issues set status='FOR_TESTING' where id=f.issue_id;
  update public.issues set status='IN_PROGRESS' where id=f.late_issue_id;
  update public.issues set status='FOR_TESTING' where id=f.late_issue_id;
  perform set_config('request.jwt.claims', json_build_object('sub',f.reporter_id,'role','authenticated')::text, true);
  perform public.qa_verify_issue(f.issue_id,'PASSED','Verified',null);
  update public.issues set status='DONE' where id=f.issue_id;
  perform public.qa_verify_issue(f.late_issue_id,'PASSED','Verified',null);
  update public.issues set status='DONE' where id=f.late_issue_id;
  if not exists(select 1 from public.v_issue_deadlines where id=f.late_issue_id and completed_late and not is_overdue)
     or not exists(select 1 from public.v_issue_deadlines where id=f.issue_id and not completed_late) then
    raise exception 'Completed issues must preserve on-time/late resolution separately from active overdue';
  end if;
  perform pg_temp.expect_deadline_denied(format(
    'update public.issues set resolve_by=null where id=%L', f.issue_id), 'P0001');

  perform set_config('request.jwt.claims', json_build_object('sub',f.outsider_id,'role','authenticated')::text, true);
  select count(*) into v_count from public.v_issue_deadlines where project_id=f.project_id;
  if v_count<>0 or exists(select 1 from public.issue_deadline_history where issue_id=f.issue_id) then
    raise exception 'Deadline views/history must enforce project isolation';
  end if;
end;
$$;
reset role;
rollback;
