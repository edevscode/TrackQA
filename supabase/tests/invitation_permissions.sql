-- Run against a disposable Supabase database after all migrations, as postgres:
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/invitation_permissions.sql
-- All fixtures and changes are rolled back.
begin;

create temporary table invitation_test_fixture (
  owner_id uuid default gen_random_uuid(),
  invitee_id uuid default gen_random_uuid(),
  project_id uuid default gen_random_uuid(),
  invitation_id uuid default gen_random_uuid(),
  invitee_email text
);
insert into invitation_test_fixture (invitee_email)
values ('invitation-audit-' || gen_random_uuid()::text || '@example.invalid');
grant select on invitation_test_fixture to authenticated;

insert into auth.users (id, email)
select owner_id, 'owner-' || owner_id::text || '@example.invalid' from invitation_test_fixture
union all
select invitee_id, invitee_email from invitation_test_fixture;

insert into public.projects (id, name, key, owner_id)
select project_id, 'Invitation permission regression',
  'T' || upper(substr(replace(project_id::text, '-', ''), 1, 8)), owner_id
from invitation_test_fixture;
insert into public.project_members (project_id, user_id, role)
select project_id, owner_id, 'OWNER' from invitation_test_fixture;
insert into public.project_invitations (id, project_id, email, role, invited_by)
select invitation_id, project_id, invitee_email, 'DEVELOPER', owner_id
from invitation_test_fixture;

select set_config('request.jwt.claims', json_build_object(
  'sub', invitee_id, 'email', invitee_email, 'role', 'authenticated'
)::text, true) from invitation_test_fixture;
set local role authenticated;

do $$
declare
  f record;
  affected integer;
begin
  select * into f from invitation_test_fixture;
  if not exists (select 1 from public.project_invitations where id = f.invitation_id) then
    raise exception 'Invitee must still be able to read their invitation';
  end if;

  update public.project_invitations
  set role = 'OWNER', status = 'ACCEPTED', expires_at = now() + interval '100 years'
  where id = f.invitation_id;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'Invitee was allowed to modify their invitation';
  end if;

  perform public.decline_project_invitation(f.invitation_id);
  if not exists (
    select 1 from public.project_invitations
    where id = f.invitation_id and status = 'DECLINED' and role = 'DEVELOPER'
  ) then
    raise exception 'Declining must work without changing the assigned role';
  end if;
end;
$$;

reset role;
select set_config('request.jwt.claims', json_build_object(
  'sub', owner_id, 'email', 'owner-' || owner_id::text || '@example.invalid',
  'role', 'authenticated'
)::text, true) from invitation_test_fixture;
set local role authenticated;

do $$
declare
  affected integer;
begin
  update public.project_invitations set status = 'PENDING', responded_at = null
  where id = (select invitation_id from invitation_test_fixture);
  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception 'Owner must retain invitation update access';
  end if;
end;
$$;

reset role;
select set_config('request.jwt.claims', json_build_object(
  'sub', invitee_id, 'email', invitee_email, 'role', 'authenticated'
)::text, true) from invitation_test_fixture;
set local role authenticated;

do $$
declare
  f record;
  membership public.project_members;
begin
  select * into f from invitation_test_fixture;
  select * into membership from public.accept_project_invitation(f.invitation_id);
  if membership.role is distinct from 'DEVELOPER'::public.project_role
     or membership.user_id is distinct from f.invitee_id
     or membership.project_id is distinct from f.project_id then
    raise exception 'Acceptance must preserve the original membership grant';
  end if;
  if not exists (
    select 1 from public.project_invitations
    where id = f.invitation_id and status = 'ACCEPTED'
  ) then
    raise exception 'Acceptance must update invitation status';
  end if;
end;
$$;

reset role;
rollback;
