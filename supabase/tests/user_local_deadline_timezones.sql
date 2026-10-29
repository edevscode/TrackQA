begin;
create temporary table user_zone_fixture (
  owner_id uuid default gen_random_uuid(), reporter_id uuid default gen_random_uuid(),
  developer_id uuid default gen_random_uuid(), project_id uuid default gen_random_uuid(), issue_id uuid default gen_random_uuid()
);
insert into user_zone_fixture default values;
grant select on user_zone_fixture to authenticated;
insert into auth.users(id,email)
select actor,actor::text||'@example.invalid' from user_zone_fixture f
cross join lateral unnest(array[f.owner_id,f.reporter_id,f.developer_id]) actor;
insert into public.projects(id,name,key,owner_id)
select project_id,'User timezone regression','Z'||upper(substr(replace(project_id::text,'-',''),1,8)),owner_id from user_zone_fixture;
insert into public.project_members(project_id,user_id,role)
select f.project_id,actor,case when actor=f.owner_id then 'OWNER'::public.project_role when actor=f.reporter_id then 'QA'::public.project_role else 'DEVELOPER'::public.project_role end
from user_zone_fixture f cross join lateral unnest(array[f.owner_id,f.reporter_id,f.developer_id]) actor;
create function pg_temp.expect_user_zone_denied(statement text,expected_state text)
returns void language plpgsql as $$
begin
  begin execute statement;
  exception when others then if sqlstate=expected_state then return; end if; raise; end;
  raise exception 'Expected SQLSTATE % for %',expected_state,statement;
end;
$$;
select set_config('request.jwt.claims',json_build_object('sub',reporter_id,'role','authenticated')::text,true) from user_zone_fixture;
set local role authenticated;
do $$
declare f record; before_issue public.issues; after_issue public.issues;
begin
  select * into f from user_zone_fixture;
  -- Raw local dates are reversed, but their real UTC cutoffs are ordered.
  insert into public.issues(id,project_id,title,assignee_id,deadline_mode,deadline_timezone,
    start_by,start_time,start_timezone,ready_for_qa_by,ready_for_qa_time,ready_for_qa_timezone,
    resolve_by,resolve_time,resolve_timezone)
  values(f.issue_id,f.project_id,'International handover',f.developer_id,'stages','America/New_York',
    '2026-11-01','00:00','Asia/Tokyo','2026-10-31','19:00','America/New_York',
    '2026-11-01','09:00','Europe/London');
  select * into before_issue from public.issues where id=f.issue_id;
  if before_issue.deadline_timezone <> 'America/New_York'
     or before_issue.start_cutoff_at <> timestamptz '2026-10-31 15:00+00'
     or before_issue.ready_for_qa_cutoff_at <> timestamptz '2026-10-31 23:00+00'
     or before_issue.resolve_cutoff_at <> timestamptz '2026-11-01 09:00+00' then
    raise exception 'Editor and per-target timezones must produce the correct UTC instants';
  end if;
  update public.issues set title='Details edited elsewhere' where id=f.issue_id;
  select * into after_issue from public.issues where id=f.issue_id;
  if row(after_issue.start_cutoff_at,after_issue.ready_for_qa_cutoff_at,after_issue.resolve_cutoff_at)
     is distinct from row(before_issue.start_cutoff_at,before_issue.ready_for_qa_cutoff_at,before_issue.resolve_cutoff_at) then
    raise exception 'Unrelated content edits must not move deadlines';
  end if;
  update public.issues set ready_for_qa_by='2026-11-01',ready_for_qa_time='13:00',ready_for_qa_timezone='Pacific/Auckland' where id=f.issue_id;
  select * into after_issue from public.issues where id=f.issue_id;
  if after_issue.ready_for_qa_cutoff_at <> timestamptz '2026-11-01 00:00+00'
     or after_issue.start_cutoff_at <> before_issue.start_cutoff_at
     or after_issue.resolve_cutoff_at <> before_issue.resolve_cutoff_at then
    raise exception 'Changing one local target must preserve the other UTC commitments';
  end if;
  if not exists(select 1 from public.issue_deadline_history where issue_id=f.issue_id
     and before_values->>'ready_for_qa_timezone'='America/New_York'
     and after_values->>'ready_for_qa_timezone'='Pacific/Auckland') then
    raise exception 'Timezone changes must remain in the audit history';
  end if;
  perform pg_temp.expect_user_zone_denied(format('update public.issues set resolve_timezone=''Invalid/Timezone'' where id=%L',f.issue_id),'22023');
  perform pg_temp.expect_user_zone_denied(format('update public.issues set deadline_timezone=''UTC'' where id=%L',f.issue_id),'42501');

  perform set_config('request.jwt.claims',json_build_object('sub',f.owner_id,'role','authenticated')::text,true);
  update public.projects set timezone='Pacific/Honolulu' where id=f.project_id;
  update public.issues set title='Project metadata changed' where id=f.issue_id;
  select * into after_issue from public.issues where id=f.issue_id;
  if after_issue.resolve_cutoff_at <> before_issue.resolve_cutoff_at then raise exception 'Project metadata must not govern saved cutoffs'; end if;
  perform set_config('request.jwt.claims',json_build_object('sub',f.developer_id,'role','authenticated')::text,true);
  perform pg_temp.expect_user_zone_denied(format('update public.issues set resolve_timezone=''UTC'' where id=%L',f.issue_id),'42501');
end;
$$;
reset role;
rollback;
