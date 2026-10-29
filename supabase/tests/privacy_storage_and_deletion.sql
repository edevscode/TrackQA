-- Run as postgres in a disposable Supabase database after all migrations.
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/privacy_storage_and_deletion.sql
begin;
create temporary table privacy_fixture (
  owner_id uuid default gen_random_uuid(),
  reporter_id uuid default gen_random_uuid(),
  developer_id uuid default gen_random_uuid(),
  invitee_id uuid default gen_random_uuid(),
  outsider_id uuid default gen_random_uuid(),
  project_id uuid default gen_random_uuid(),
  issue_id uuid default gen_random_uuid()
);
insert into privacy_fixture default values;
grant select on privacy_fixture to authenticated;

insert into auth.users (id, email)
select actor, actor::text || '@example.invalid' from privacy_fixture f
cross join lateral unnest(array[f.owner_id, f.reporter_id, f.developer_id,
  f.invitee_id, f.outsider_id]) actor;
insert into public.projects (id, name, key, owner_id)
select project_id, 'Privacy regression',
  'T' || upper(substr(replace(project_id::text, '-', ''), 1, 8)), owner_id from privacy_fixture;
insert into public.project_members (project_id, user_id, role)
select f.project_id, actor,
  case when actor = f.owner_id then 'OWNER'::public.project_role
       else 'DEVELOPER'::public.project_role end
from privacy_fixture f
cross join lateral unnest(array[f.owner_id, f.reporter_id, f.developer_id]) actor;
insert into public.project_invitations (project_id, email, invited_by)
select project_id, invitee_id::text || '@example.invalid', owner_id from privacy_fixture;

select set_config('request.jwt.claims', json_build_object(
  'sub', reporter_id, 'email', reporter_id::text || '@example.invalid', 'role', 'authenticated'
)::text, true) from privacy_fixture;
set local role authenticated;
insert into public.issues (id, project_id, title, assignee_id)
select issue_id, project_id, 'Private evidence', developer_id from privacy_fixture;

do $$
declare f record; affected integer;
begin
  select * into f from privacy_fixture;
  if (select count(*) from public.profiles where id in (f.owner_id, f.reporter_id, f.developer_id)) <> 3
     or exists (select 1 from public.profiles where id in (f.invitee_id, f.outsider_id)) then
    raise exception 'Profile visibility must be scoped to shared projects';
  end if;

  insert into storage.objects (bucket_id, name, owner)
  values ('issue-attachments', f.project_id::text || '/' || f.issue_id::text || '/evidence', f.reporter_id);

  perform set_config('request.jwt.claims', json_build_object(
    'sub', f.developer_id, 'email', f.developer_id::text || '@example.invalid',
    'role', 'authenticated')::text, true);
  if not exists (select 1 from storage.objects where bucket_id = 'issue-attachments'
      and name = f.project_id::text || '/' || f.issue_id::text || '/evidence') then
    raise exception 'Project members must be able to read private evidence';
  end if;
  delete from public.issues where id = f.issue_id;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'An unrelated developer deleted the issue'; end if;

  perform set_config('request.jwt.claims', json_build_object(
    'sub', f.invitee_id, 'email', f.invitee_id::text || '@example.invalid',
    'role', 'authenticated')::text, true);
  if not exists (select 1 from public.profiles where id = f.owner_id)
     or exists (select 1 from public.profiles where id = f.reporter_id) then
    raise exception 'Invitees may see inviter context but not the whole project directory';
  end if;
  if exists (select 1 from storage.objects where bucket_id = 'issue-attachments'
      and name = f.project_id::text || '/' || f.issue_id::text || '/evidence') then
    raise exception 'Pending invitees must not read private issue evidence';
  end if;

  perform set_config('request.jwt.claims', json_build_object(
    'sub', f.outsider_id, 'email', f.outsider_id::text || '@example.invalid',
    'role', 'authenticated')::text, true);
  if exists (select 1 from public.profiles where id in (f.owner_id, f.reporter_id, f.developer_id)) then
    raise exception 'Outsiders must not enumerate profile details';
  end if;
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('issue-attachments', f.project_id::text || '/' || f.issue_id::text || '/attack', f.outsider_id);
    raise exception 'Outsider uploaded into a private issue';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claims', json_build_object(
    'sub', f.owner_id, 'email', f.owner_id::text || '@example.invalid',
    'role', 'authenticated')::text, true);
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('issue-attachments', f.project_id::text || '/' || gen_random_uuid()::text || '/wrong-issue', f.owner_id);
    raise exception 'Upload path must identify a real issue in the project';
  exception when insufficient_privilege then null;
  end;
  delete from public.issues where id = f.issue_id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Project owner must be able to delete an issue'; end if;
end;
$$;
reset role;
rollback;
