-- Run as postgres against a disposable Supabase database after all migrations:
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/issue_update_permissions.sql
-- Exercises real authenticated RLS/trigger paths. Fixtures are rolled back.
begin;

create temporary table issue_test_fixture (
  owner_id uuid default gen_random_uuid(),
  reporter_id uuid default gen_random_uuid(),
  developer_id uuid default gen_random_uuid(),
  qa_id uuid default gen_random_uuid(),
  other_developer_id uuid default gen_random_uuid(),
  project_id uuid default gen_random_uuid(),
  other_project_id uuid default gen_random_uuid(),
  issue_id uuid default gen_random_uuid()
);
insert into issue_test_fixture default values;
grant select on issue_test_fixture to authenticated;

insert into auth.users (id, email)
select actor_id, actor_id::text || '@example.invalid'
from issue_test_fixture f
cross join lateral unnest(array[f.owner_id, f.reporter_id, f.developer_id,
  f.qa_id, f.other_developer_id]) actor_id;

insert into public.projects (id, name, key, owner_id)
select pid, 'Issue permission regression',
  'T' || upper(substr(replace(pid::text, '-', ''), 1, 8)), f.owner_id
from issue_test_fixture f
cross join lateral unnest(array[f.project_id, f.other_project_id]) pid;

insert into public.project_members (project_id, user_id, role)
select pid, actor_id,
  case when actor_id = f.owner_id then 'OWNER'::public.project_role
       when actor_id in (f.reporter_id, f.qa_id) then 'QA'::public.project_role
       else 'DEVELOPER'::public.project_role end
from issue_test_fixture f
cross join lateral unnest(array[f.project_id, f.other_project_id]) pid
cross join lateral unnest(array[f.owner_id, f.reporter_id, f.developer_id,
  f.qa_id, f.other_developer_id]) actor_id;

select set_config('request.jwt.claims', json_build_object(
  'sub', reporter_id, 'role', 'authenticated'
)::text, true) from issue_test_fixture;
set local role authenticated;
insert into public.issues (id, project_id, title, assignee_id)
select issue_id, project_id, 'Original report', developer_id from issue_test_fixture;
reset role;

-- Invoker security is essential: each attempted update runs as authenticated.
create function pg_temp.expect_issue_update_denied(statement text, expected_state text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if sqlstate = expected_state then return; end if;
    raise;
  end;
  raise exception 'Expected SQLSTATE % for: %', expected_state, statement;
end;
$$;

-- Force a failure after the RPC inserts history to prove transaction rollback.
-- The test-only trigger and function disappear when this script rolls back.
create function pg_temp.fail_test_qa_update()
returns trigger language plpgsql as $$
begin
  if old.title = 'Force QA rollback' and new.status = 'PASSED'
     and new.id = (select issue_id from issue_test_fixture) then
    raise exception 'Simulated QA status write failure';
  end if;
  return new;
end;
$$;
create trigger trg_test_fail_qa_update before update on public.issues
for each row execute function pg_temp.fail_test_qa_update();

set local role authenticated;
do $$
declare
  f record;
  actor uuid;
  assignment text;
  affected integer;
begin
  select * into f from issue_test_fixture;
  foreach actor in array array[f.owner_id, f.reporter_id, f.developer_id,
    f.qa_id, f.other_developer_id] loop
    perform set_config('request.jwt.claims', json_build_object(
      'sub', actor, 'role', 'authenticated')::text, true);

    -- Even owners/reporters cannot rewrite identity. Both projects have the
    -- same members so cross-project RLS alone cannot hide a missing guard.
    foreach assignment in array array[
      format('reporter_id = %L', f.other_developer_id),
      'reporter_id = null',
      format('project_id = %L', f.other_project_id),
      'issue_number = issue_number + 100',
      'id = gen_random_uuid()',
      'created_at = created_at - interval ''1 day'''
    ] loop
      perform pg_temp.expect_issue_update_denied(
        format('update public.issues set %s where id = %L', assignment, f.issue_id), '22023');
    end loop;

    if actor in (f.owner_id, f.reporter_id) then
      update public.issues set title = 'Authorized edit', description = 'Details',
        priority = 'HIGH', assignee_id = f.developer_id,
        steps_to_reproduce = 'Steps', expected_result = 'Expected', actual_result = 'Actual',
        environment_device = 'Desktop', environment_browser = 'Browser',
        environment_app_version = '1.0'
      where id = f.issue_id;
      get diagnostics affected = row_count;
      if affected <> 1 then raise exception 'Authorized edit did not update an issue'; end if;
      -- Ensure the next authorized actor also changes every field.
      update public.issues set title = 'Original report', description = null,
        priority = 'MEDIUM', steps_to_reproduce = null, expected_result = null,
        actual_result = null, environment_device = null, environment_browser = null,
        environment_app_version = null where id = f.issue_id;
    else
      foreach assignment in array array[
        'title = ''Unauthorized edit''', 'description = ''Unauthorized edit''',
        'steps_to_reproduce = ''Unauthorized edit''', 'expected_result = ''Unauthorized edit''',
        'actual_result = ''Unauthorized edit''', 'environment_device = ''Unauthorized edit''',
        'environment_browser = ''Unauthorized edit''', 'environment_app_version = ''Unauthorized edit''',
        'priority = ''CRITICAL''', format('assignee_id = %L', f.other_developer_id)
      ] loop
        perform pg_temp.expect_issue_update_denied(
          format('update public.issues set %s where id = %L', assignment, f.issue_id), '42501');
      end loop;
    end if;
  end loop;

  perform set_config('request.jwt.claims', json_build_object(
    'sub', f.other_developer_id, 'role', 'authenticated')::text, true);
  perform pg_temp.expect_issue_update_denied(format(
    'update public.issues set status = ''IN_PROGRESS'' where id = %L', f.issue_id), 'P0001');
  perform pg_temp.expect_issue_update_denied(format(
    'select public.qa_verify_issue(%L, ''PASSED'')', f.issue_id), '42501');

  perform set_config('request.jwt.claims', json_build_object(
    'sub', f.owner_id, 'role', 'authenticated')::text, true);
  perform pg_temp.expect_issue_update_denied(format(
    'select public.qa_verify_issue(%L, ''PASSED'')', f.issue_id), '42501');

  perform set_config('request.jwt.claims', json_build_object(
    'sub', f.reporter_id, 'role', 'authenticated')::text, true);
  perform pg_temp.expect_issue_update_denied(format(
    'select public.qa_verify_issue(%L, ''PASSED'')', f.issue_id), '22023');

  -- The takeover + verification attack must also fail as a combined update.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', f.developer_id, 'role', 'authenticated')::text, true);
  perform pg_temp.expect_issue_update_denied(format(
    'update public.issues set reporter_id = %L, status = ''PASSED'' where id = %L',
    f.developer_id, f.issue_id), '22023');

  update public.issues set status = 'IN_PROGRESS' where id = f.issue_id;
  update public.issues set status = 'FOR_TESTING' where id = f.issue_id;
  perform pg_temp.expect_issue_update_denied(format(
    'update public.issues set status = ''PASSED'' where id = %L', f.issue_id), '42501');

  perform set_config('request.jwt.claims', json_build_object(
    'sub', f.reporter_id, 'role', 'authenticated')::text, true);
  perform pg_temp.expect_issue_update_denied(format(
    'update public.issues set status = ''PASSED'' where id = %L', f.issue_id), '42501');
  perform pg_temp.expect_issue_update_denied(format(
    'update public.issues set status = ''FAILED'' where id = %L', f.issue_id), '42501');
  perform pg_temp.expect_issue_update_denied(format(
    'insert into public.qa_verifications (issue_id, qa_user_id, result) values (%L, %L, ''PASSED'')',
    f.issue_id, f.reporter_id), '42501');
  perform pg_temp.expect_issue_update_denied(format(
    'select public.qa_verify_issue(%L, null)', f.issue_id), '22023');
  perform pg_temp.expect_issue_update_denied(format(
    'select public.qa_verify_issue(%L, ''FAILED'', null, null)', f.issue_id), '22023');
  perform pg_temp.expect_issue_update_denied(format(
    'select public.qa_verify_issue(%L, ''FAILED'', null, %L)', f.issue_id, E' \t\n'), '22023');

  update public.issues set title = 'Force QA rollback' where id = f.issue_id;
  perform pg_temp.expect_issue_update_denied(format(
    'select public.qa_verify_issue(%L, ''PASSED'')', f.issue_id), 'P0001');
  if exists (select 1 from public.qa_verifications where issue_id = f.issue_id)
     or not exists (select 1 from public.issues where id = f.issue_id and status = 'FOR_TESTING') then
    raise exception 'Rejected verification must not leave history or a changed status';
  end if;
  update public.issues set title = 'Original report' where id = f.issue_id;
  perform public.qa_verify_issue(f.issue_id, 'FAILED', null, 'Still reproduces');
  perform pg_temp.expect_issue_update_denied(format(
    'select public.qa_verify_issue(%L, ''FAILED'', null, ''Duplicate'')', f.issue_id), '22023');

  perform set_config('request.jwt.claims', json_build_object(
    'sub', f.developer_id, 'role', 'authenticated')::text, true);
  update public.issues set status = 'IN_PROGRESS' where id = f.issue_id;
  update public.issues set status = 'FOR_TESTING' where id = f.issue_id;

  perform set_config('request.jwt.claims', json_build_object(
    'sub', f.reporter_id, 'role', 'authenticated')::text, true);
  perform public.qa_verify_issue(f.issue_id, 'PASSED', 'Verified', null);
  perform pg_temp.expect_issue_update_denied(format(
    'select public.qa_verify_issue(%L, ''PASSED'')', f.issue_id), '22023');
  if (select count(*) from public.qa_verifications where issue_id = f.issue_id) <> 2 then
    raise exception 'Exactly one verification must exist for each QA cycle';
  end if;
  update public.issues set status = 'DONE' where id = f.issue_id;
  if not exists (select 1 from public.issues where id = f.issue_id and status = 'DONE') then
    raise exception 'Normal development and QA workflow did not complete';
  end if;
  perform pg_temp.expect_issue_update_denied(format(
    'update public.issues set title = ''Changed after completion'' where id = %L',
    f.issue_id), 'P0001');
end;
$$;

reset role;
rollback;
