begin;
create temporary table responsibility_fixture (
  project_id uuid default gen_random_uuid(), other_project_id uuid default gen_random_uuid(),
  owner_id uuid default gen_random_uuid(), qa_id uuid default gen_random_uuid(),
  dev_id uuid default gen_random_uuid(), other_dev_id uuid default gen_random_uuid(),
  other_qa_id uuid default gen_random_uuid(), outsider_id uuid default gen_random_uuid(),
  other_owner_id uuid default gen_random_uuid(), issue_id uuid default gen_random_uuid(),
  owner_issue_id uuid default gen_random_uuid()
);
insert into responsibility_fixture default values;
grant select on responsibility_fixture to authenticated;
insert into auth.users(id,email)
select actor, actor::text || '@example.invalid' from responsibility_fixture f
cross join lateral unnest(array[f.owner_id,f.qa_id,f.dev_id,f.other_dev_id,f.other_qa_id,f.outsider_id,f.other_owner_id]) actor;
insert into public.projects(id,name,key,owner_id)
select project, 'Responsibility regression', 'R' || upper(substr(replace(project::text,'-',''),1,8)), owner_id
from responsibility_fixture f cross join lateral unnest(array[f.project_id,f.other_project_id]) project;
insert into public.project_members(project_id,user_id,role)
select f.project_id, actor, case when actor in (f.owner_id,f.other_owner_id) then 'OWNER'::public.project_role
  when actor in (f.qa_id,f.other_qa_id) then 'QA'::public.project_role else 'DEVELOPER'::public.project_role end
from responsibility_fixture f cross join lateral unnest(array[f.owner_id,f.qa_id,f.dev_id,f.other_dev_id,f.other_qa_id,f.other_owner_id]) actor;
insert into public.project_members(project_id,user_id,role)
select other_project_id,outsider_id,'DEVELOPER' from responsibility_fixture;

create function pg_temp.expect_responsibility_denied(statement text, expected_state text)
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
set local role authenticated;
do $$
declare f record;
begin
  select * into f from responsibility_fixture;
  perform set_config('request.jwt.claims', json_build_object('sub',f.dev_id,'role','authenticated')::text,true);
  perform pg_temp.expect_responsibility_denied(format(
    'insert into public.issues(project_id,title,reporter_id,status) values(%L,''Developer spoof'',%L,''DONE'')',f.project_id,f.qa_id),'42501');
  perform set_config('request.jwt.claims', json_build_object('sub',f.outsider_id,'role','authenticated')::text,true);
  perform pg_temp.expect_responsibility_denied(format(
    'insert into public.issues(project_id,title) values(%L,''Outsider report'')',f.project_id),'42501');

  perform set_config('request.jwt.claims', json_build_object('sub',f.qa_id,'role','authenticated')::text,true);
  insert into public.issues(id,project_id,title,assignee_id,reporter_id,status)
  values(f.issue_id,f.project_id,'QA report',f.dev_id,f.owner_id,'DONE');
  if not exists(select 1 from public.issues where id=f.issue_id and reporter_id=f.qa_id and status='OPEN') then
    raise exception 'Creation must retain the real reporter and OPEN status';
  end if;
  insert into public.issues(project_id,title) values(f.project_id,'Unassigned QA report');
  perform pg_temp.expect_responsibility_denied(format(
    'insert into public.issues(project_id,title,assignee_id) values(%L,''QA assignment'',%L)',f.project_id,f.other_qa_id),'42501');
  perform pg_temp.expect_responsibility_denied(format(
    'insert into public.issues(project_id,title,assignee_id) values(%L,''Foreign developer'',%L)',f.project_id,f.outsider_id),'42501');
  perform pg_temp.expect_responsibility_denied(format(
    'update public.issues set assignee_id=%L where id=%L',f.other_qa_id,f.issue_id),'42501');
  perform pg_temp.expect_responsibility_denied(format(
    'update public.issues set status=''IN_PROGRESS'' where id=%L',f.issue_id),'P0001');

  perform set_config('request.jwt.claims', json_build_object('sub',f.other_dev_id,'role','authenticated')::text,true);
  perform pg_temp.expect_responsibility_denied(format(
    'update public.issues set status=''IN_PROGRESS'' where id=%L',f.issue_id),'P0001');
  perform set_config('request.jwt.claims', json_build_object('sub',f.dev_id,'role','authenticated')::text,true);
  update public.issues set status='IN_PROGRESS' where id=f.issue_id;

  perform set_config('request.jwt.claims', json_build_object('sub',f.owner_id,'role','authenticated')::text,true);
  insert into public.issues(id,project_id,title,assignee_id) values(f.owner_issue_id,f.project_id,'Owner report',f.other_owner_id);
  -- Owner permissions still require assignment for development and reporter identity for QA.
  perform pg_temp.expect_responsibility_denied(format(
    'update public.issues set status=''FOR_TESTING'' where id=%L',f.issue_id),'P0001');
  perform pg_temp.expect_responsibility_denied(format(
    'update public.issues set assignee_id=%L where id=%L',f.qa_id,f.issue_id),'42501');
  perform pg_temp.expect_responsibility_denied(format(
    'update public.project_members set role=''QA'' where project_id=%L and user_id=%L',f.project_id,f.dev_id),'23514');
  perform pg_temp.expect_responsibility_denied(format(
    'delete from public.project_members where project_id=%L and user_id=%L',f.project_id,f.dev_id),'23514');
  perform pg_temp.expect_responsibility_denied(format(
    'update public.project_members set role=''DEVELOPER'' where project_id=%L and user_id=%L',f.project_id,f.qa_id),'23514');
  perform pg_temp.expect_responsibility_denied(format(
    'delete from public.project_members where project_id=%L and user_id=%L',f.project_id,f.qa_id),'23514');
  perform pg_temp.expect_responsibility_denied(format(
    'update public.project_members set user_id=%L where project_id=%L and user_id=%L',f.outsider_id,f.project_id,f.qa_id),'22023');
  -- Reassigning removes the developer's obligation and permits a role change.
  update public.issues set assignee_id=f.other_dev_id where id=f.issue_id;
  update public.project_members set role='QA' where project_id=f.project_id and user_id=f.dev_id;
  delete from public.project_members where project_id=f.project_id and user_id=f.dev_id;
  perform set_config('request.jwt.claims', json_build_object('sub',f.qa_id,'role','authenticated')::text,true);
  perform pg_temp.expect_responsibility_denied(format(
    'delete from public.project_members where project_id=%L and user_id=%L',f.project_id,f.qa_id),'23514');

  perform set_config('request.jwt.claims', json_build_object('sub',f.other_dev_id,'role','authenticated')::text,true);
  update public.issues set status='FOR_TESTING' where id=f.issue_id;
  perform pg_temp.expect_responsibility_denied(format(
    'update public.issues set status=''PASSED'' where id=%L',f.issue_id),'42501');
  perform set_config('request.jwt.claims', json_build_object('sub',f.other_qa_id,'role','authenticated')::text,true);
  perform pg_temp.expect_responsibility_denied(format(
    'select public.qa_verify_issue(%L,''PASSED'',null,null)',f.issue_id),'42501');
  perform set_config('request.jwt.claims', json_build_object('sub',f.owner_id,'role','authenticated')::text,true);
  perform pg_temp.expect_responsibility_denied(format(
    'select public.qa_verify_issue(%L,''PASSED'',null,null)',f.issue_id),'42501');
  perform set_config('request.jwt.claims', json_build_object('sub',f.qa_id,'role','authenticated')::text,true);
  perform public.qa_verify_issue(f.issue_id,'FAILED',null,'Needs another fix');
  perform set_config('request.jwt.claims', json_build_object('sub',f.other_dev_id,'role','authenticated')::text,true);
  update public.issues set status='IN_PROGRESS' where id=f.issue_id;
  update public.issues set status='FOR_TESTING' where id=f.issue_id;
  perform set_config('request.jwt.claims', json_build_object('sub',f.qa_id,'role','authenticated')::text,true);
  perform public.qa_verify_issue(f.issue_id,'PASSED','Verified',null);
  perform set_config('request.jwt.claims', json_build_object('sub',f.owner_id,'role','authenticated')::text,true);
  update public.issues set status='DONE' where id=f.issue_id;
  delete from public.issues where reporter_id=f.qa_id and id<>f.issue_id;
  update public.project_members set role='DEVELOPER' where project_id=f.project_id and user_id=f.qa_id;
  delete from public.project_members where project_id=f.project_id and user_id=f.qa_id;
  if (select count(*) from public.qa_verifications where issue_id=f.issue_id)<>2 then
    raise exception 'Role changes must preserve QA history';
  end if;
  -- A promoted OWNER can perform assigned development; the reporter OWNER verifies.
  perform set_config('request.jwt.claims', json_build_object('sub',f.other_owner_id,'role','authenticated')::text,true);
  update public.issues set status='IN_PROGRESS' where id=f.owner_issue_id;
  update public.issues set status='FOR_TESTING' where id=f.owner_issue_id;
  perform set_config('request.jwt.claims', json_build_object('sub',f.owner_id,'role','authenticated')::text,true);
  perform public.qa_verify_issue(f.owner_issue_id,'PASSED',null,null);
  update public.issues set status='DONE' where id=f.owner_issue_id;
  update public.project_members set role='DEVELOPER' where project_id=f.project_id and user_id=f.other_owner_id;
  -- Keep the existing last-owner protection after work is complete.
  perform pg_temp.expect_responsibility_denied(format(
    'update public.project_members set role=''QA'' where project_id=%L and user_id=%L',f.project_id,f.owner_id),'P0001');
end;
$$;
rollback;
