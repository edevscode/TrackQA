begin;
create temporary table timing_fixture (
  owner_id uuid default gen_random_uuid(), reporter_id uuid default gen_random_uuid(),
  developer_id uuid default gen_random_uuid(), outsider_id uuid default gen_random_uuid(),
  project_id uuid default gen_random_uuid(), issue_id uuid default gen_random_uuid()
);
insert into timing_fixture default values;
grant select on timing_fixture to authenticated;
insert into auth.users(id,email)
select actor, actor::text || '@example.invalid' from timing_fixture f
cross join lateral unnest(array[f.owner_id,f.reporter_id,f.developer_id,f.outsider_id]) actor;
insert into public.projects(id,name,key,owner_id)
select project_id,'Timed deadlines','T'||upper(substr(replace(project_id::text,'-',''),1,8)),owner_id from timing_fixture;
insert into public.project_members(project_id,user_id,role)
select f.project_id,actor,case when actor=f.owner_id then 'OWNER'::public.project_role else 'DEVELOPER'::public.project_role end
from timing_fixture f cross join lateral unnest(array[f.owner_id,f.reporter_id,f.developer_id]) actor;

create function pg_temp.expect_timing_denied(statement text,expected_state text)
returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then if sqlstate=expected_state then return; end if; raise; end;
  raise exception 'Expected SQLSTATE % for %',expected_state,statement;
end;
$$;
select set_config('request.jwt.claims',json_build_object('sub',reporter_id,'role','authenticated')::text,true) from timing_fixture;
set local role authenticated;
do $$
declare
  f record; v_local timestamp := date_trunc('minute',now() at time zone 'Asia/Manila');
  v_early timestamp; v_later timestamp; v_issue public.issues;
begin
  select * into f from timing_fixture;
  v_early:=v_local-interval '2 minutes'; v_later:=v_local+interval '2 hours';
  if public.issue_deadline_cutoff('2026-10-30','17:00','Asia/Manila') <> timestamptz '2026-10-30 09:00:00+00'
     or public.issue_deadline_cutoff('2026-10-30',null,'Asia/Manila') <> timestamptz '2026-10-30 15:59:59.999999+00' then
    raise exception 'UTC cutoffs must match explicit time and end-of-day choices';
  end if;
  if public.issue_deadline_cutoff('2026-10-29',null,'Africa/Cairo') <> timestamptz '2026-10-29 21:59:59.999999+00'
     or public.issue_deadline_cutoff('2026-09-05',null,'America/Santiago') <> timestamptz '2026-09-06 03:59:59.999999+00' then
    raise exception 'End of day must include the entire local day across clock changes';
  end if;
  perform pg_temp.expect_timing_denied('select public.issue_deadline_cutoff(''2011-12-30'',null,''Pacific/Apia'')','22023');
  perform pg_temp.expect_timing_denied('select public.issue_deadline_cutoff(''2026-03-08'',''02:30'',''America/New_York'')','22023');
  perform pg_temp.expect_timing_denied('select public.issue_deadline_cutoff(''2026-11-01'',''01:30'',''America/New_York'')','22023');
  perform pg_temp.expect_timing_denied('select public.issue_deadline_cutoff(''2026-10-30'',''24:00'',''Asia/Manila'')','22023');
  if public.issue_deadline_cutoff('2026-10-30','17:00:01','Asia/Manila') <> timestamptz '2026-10-30 09:00:01+00' then
    raise exception 'Timezone conversion must preserve sub-minute cutoffs';
  end if;

  insert into public.issues(id,project_id,title,assignee_id,deadline_timezone)
  values(f.issue_id,f.project_id,'Timed issue',f.developer_id,'Asia/Manila');
  perform pg_temp.expect_timing_denied(format('update public.issues set resolve_by=%L where id=%L',v_local::date,f.issue_id),'23514');
  perform pg_temp.expect_timing_denied(format('update public.issues set deadline_mode=''single'' where id=%L',f.issue_id),'23514');
  perform pg_temp.expect_timing_denied(format('update public.issues set deadline_mode=''stages'' where id=%L',f.issue_id),'23514');
  perform pg_temp.expect_timing_denied(format('update public.issues set resolve_time=''17:00'' where id=%L',f.issue_id),'23514');
  perform pg_temp.expect_timing_denied(format('update public.issues set resolve_cutoff_at=now() where id=%L',f.issue_id),'42501');

  update public.issues set deadline_mode='single',resolve_by=v_early::date,resolve_time=v_early::time where id=f.issue_id;
  if not exists(select 1 from public.v_issue_deadlines where id=f.issue_id and is_overdue and not has_missed_target) then
    raise exception 'Single mode must compare exact resolution cutoff';
  end if;
  perform set_config('request.jwt.claims',json_build_object('sub',f.owner_id,'role','authenticated')::text,true);
  update public.issues set resolve_by=v_later::date,resolve_time=v_later::time where id=f.issue_id;
  if exists(select 1 from public.v_issue_deadlines where id=f.issue_id and is_overdue) then raise exception 'Future timed cutoff cannot be overdue'; end if;

  -- Partial stage planning is independent of the resolution deadline.
  update public.issues set deadline_mode='stages',resolve_by=null,resolve_time=null,
    start_by=v_early::date,start_time=v_early::time,
    ready_for_qa_by=v_later::date,ready_for_qa_time=v_later::time where id=f.issue_id;
  if not exists(select 1 from public.v_issue_deadlines where id=f.issue_id and not is_overdue and has_missed_target and resolve_cutoff_at is null) then
    raise exception 'Stage-only targets must not require an overall deadline';
  end if;
  perform pg_temp.expect_timing_denied(format('update public.issues set start_by=%L,start_time=''18:00'',ready_for_qa_by=%L,ready_for_qa_time=''17:00'' where id=%L',v_local::date,v_local::date,f.issue_id),'23514');
  perform set_config('request.jwt.claims',json_build_object('sub',f.developer_id,'role','authenticated')::text,true);
  perform pg_temp.expect_timing_denied(format('update public.issues set start_time=''10:00'' where id=%L',f.issue_id),'42501');
  perform pg_temp.expect_timing_denied(format('update public.issues set deadline_mode=''single'' where id=%L',f.issue_id),'42501');
  update public.issues set status='IN_PROGRESS' where id=f.issue_id;

  perform set_config('request.jwt.claims',json_build_object('sub',f.reporter_id,'role','authenticated')::text,true);
  perform pg_temp.expect_timing_denied(format('update public.issues set deadline_mode=''single'',resolve_by=%L,resolve_time=%L where id=%L',v_later::date,v_later::time,f.issue_id),'23514');
  update public.issues set deadline_mode='single',start_by=null,start_time=null,ready_for_qa_by=null,ready_for_qa_time=null,
    resolve_by=v_later::date,resolve_time=v_later::time where id=f.issue_id;
  if not exists(select 1 from public.issue_deadline_history where issue_id=f.issue_id and actor_id=f.reporter_id
      and before_values->>'deadline_mode'='stages' and after_values->>'deadline_mode'='single'
      and before_values->>'start_time' is not null and after_values->>'start_time' is null) then
    raise exception 'Mode switches must preserve removed timed targets in history';
  end if;
  select * into v_issue from public.issues where id=f.issue_id;
  if v_issue.start_cutoff_at is not null or v_issue.ready_for_qa_cutoff_at is not null then raise exception 'Inactive stage cutoffs survived mode switch'; end if;
  update public.issues set deadline_mode='none',resolve_by=null,resolve_time=null where id=f.issue_id;
  if not exists(select 1 from public.v_issue_deadlines where id=f.issue_id and not is_overdue and not has_missed_target and resolve_cutoff_at is null) then
    raise exception 'No deadline must clear all live indicators';
  end if;
  perform set_config('request.jwt.claims',json_build_object('sub',f.outsider_id,'role','authenticated')::text,true);
  if exists(select 1 from public.v_issue_deadlines where id=f.issue_id) then raise exception 'Timed deadlines must respect project isolation'; end if;
end;
$$;
reset role;
rollback;
