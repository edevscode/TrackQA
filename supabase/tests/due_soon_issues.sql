begin;
set local timezone = 'America/New_York';
create temporary table soon_fixture(owner_id uuid default gen_random_uuid(), outsider_id uuid default gen_random_uuid(), project_id uuid default gen_random_uuid());
insert into soon_fixture default values;
create temporary table soon_cases (
  id uuid primary key default gen_random_uuid(), label text, mode text, desired_status public.issue_status,
  resolution timestamptz, start_target timestamptz, ready_target timestamptz, qa_target timestamptz,
  expected_next timestamptz, expected_soon boolean
);
grant select on soon_fixture to authenticated;
grant select,insert on soon_cases to authenticated;
insert into auth.users(id,email)
select actor,actor::text||'@example.invalid' from soon_fixture f cross join lateral unnest(array[f.owner_id,f.outsider_id]) actor;
insert into public.projects(id,name,key,owner_id)
select project_id,'Due soon regression','D'||upper(substr(replace(project_id::text,'-',''),1,8)),owner_id from soon_fixture;
insert into public.project_members(project_id,user_id,role) select project_id,owner_id,'OWNER' from soon_fixture;
select set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated')::text,true) from soon_fixture;
set local role authenticated;
do $$
declare f record; c record; n timestamptz := now(); first_issue uuid;
begin
  select * into f from soon_fixture;
  insert into soon_cases(label,mode,desired_status,resolution,start_target,ready_target,qa_target,expected_next,expected_soon) values
    ('none','none','OPEN',null,null,null,null,null,false),
    ('single-now','single','OPEN',n,null,null,null,n,true),
    ('single-near','single','OPEN',n+interval '1 hour',null,null,null,n+interval '1 hour',true),
    ('single-boundary','single','OPEN',n+interval '168 hours',null,null,null,n+interval '168 hours',true),
    ('single-outside','single','OPEN',n+interval '168 hours 1 second',null,null,null,n+interval '168 hours 1 second',false),
    ('single-overdue','single','OPEN',n-interval '1 second',null,null,null,n-interval '1 second',false),
    ('completed','single','DONE',n+interval '1 hour',null,null,null,null,false),
    ('many-stage-targets','stages','OPEN',n+interval '4 hours',n+interval '1 hour',n+interval '2 hours',n+interval '3 hours',n+interval '1 hour',true),
    ('blocked-stage','stages','OPEN',null,n-interval '1 hour',n+interval '1 hour',null,n-interval '1 hour',false),
    ('late-start-next-upcoming','stages','IN_PROGRESS',null,n-interval '1 hour',n+interval '1 hour',null,n+interval '1 hour',true),
    ('partial-qa-target','stages','OPEN',null,null,null,n+interval '1 hour',n+interval '1 hour',true),
    ('ready-for-qa','stages','FOR_TESTING',null,null,n-interval '1 hour',n+interval '1 hour',n+interval '1 hour',true),
    ('qa-complete-no-close','stages','PASSED',null,null,null,n+interval '1 hour',null,false),
    ('stage-close-only','stages','OPEN',n+interval '1 hour',null,null,null,n+interval '1 hour',true),
    ('qa-complete-close-soon','stages','PASSED',n+interval '1 hour',null,null,n-interval '1 hour',n+interval '1 hour',true),
    ('stage-outside','stages','OPEN',null,n+interval '9 days',null,null,n+interval '9 days',false);

  for c in select * from soon_cases loop
    insert into public.issues(id,project_id,title,reporter_id,assignee_id,deadline_mode,deadline_timezone,
      resolve_by,resolve_time,resolve_timezone,start_by,start_time,start_timezone,
      ready_for_qa_by,ready_for_qa_time,ready_for_qa_timezone,qa_decision_by,qa_decision_time,qa_decision_timezone)
    values(c.id,f.project_id,c.label,f.owner_id,f.owner_id,c.mode,'UTC',
      (c.resolution at time zone 'UTC')::date,(c.resolution at time zone 'UTC')::time,'UTC',
      (c.start_target at time zone 'UTC')::date,(c.start_target at time zone 'UTC')::time,'UTC',
      (c.ready_target at time zone 'UTC')::date,(c.ready_target at time zone 'UTC')::time,'UTC',
      (c.qa_target at time zone 'UTC')::date,(c.qa_target at time zone 'UTC')::time,'UTC');
    if c.desired_status <> 'OPEN' then update public.issues set status='IN_PROGRESS' where id=c.id; end if;
    if c.desired_status in ('FOR_TESTING','PASSED','DONE') then update public.issues set status='FOR_TESTING' where id=c.id; end if;
    if c.desired_status in ('PASSED','DONE') then perform public.qa_verify_issue(c.id,'PASSED','Verified',null); end if;
    if c.desired_status = 'DONE' then update public.issues set status='DONE' where id=c.id; end if;
  end loop;
  if exists(select 1 from soon_cases expected join public.v_issue_deadlines i on i.id=expected.id
    where i.is_due_soon is distinct from expected.expected_soon or i.next_deadline_at is distinct from expected.expected_next) then
    raise exception 'Pending target or due-soon eligibility disagrees with expected boundary/workflow cases';
  end if;
  if not exists(select 1 from public.v_project_dashboard_stats where project_id=f.project_id
    and due_soon_issues=(select count(*) from soon_cases where expected_soon)) then
    raise exception 'Dashboard count must equal the filtered issue count, once per issue';
  end if;
  if not exists(select 1 from public.v_issue_deadlines where title='late-start-next-upcoming' and project_id=f.project_id
    and has_missed_target and is_due_soon) then raise exception 'A late completed stage may overlap with an upcoming next target'; end if;
  select id into first_issue from public.v_issue_deadlines where project_id=f.project_id and is_due_soon order by next_deadline_at,id limit 1;
  if first_issue <> (select id from soon_cases where label='single-now') then raise exception 'Due-soon sorting must use the nearest pending target'; end if;
  perform set_config('request.jwt.claims',json_build_object('sub',f.outsider_id,'role','authenticated')::text,true);
  if exists(select 1 from public.v_issue_deadlines where project_id=f.project_id)
    or exists(select 1 from public.v_project_dashboard_stats where project_id=f.project_id) then
    raise exception 'Due-soon views must preserve project isolation';
  end if;
end;
$$;
reset role;
rollback;
