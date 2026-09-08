-- 0017_project_access_code.sql
-- Add project access code support for direct workspace joining

-- 1. Helper function to generate an 8-character uppercase alphanumeric code
create or replace function public.generate_project_access_code()
returns text
language plpgsql
as $$
declare
  v_code text;
  v_exists boolean;
begin
  loop
    v_code := upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 8));
    select exists(select 1 from public.projects where access_code = v_code) into v_exists;
    if not v_exists then
      return v_code;
    end if;
  end loop;
end;
$$;

-- 2. Add access_code column to projects
alter table public.projects
add column if not exists access_code text unique;

-- 3. Backfill existing projects with unique access codes
do $$
declare
  r record;
begin
  for r in select id from public.projects where access_code is null loop
    update public.projects
    set access_code = public.generate_project_access_code()
    where id = r.id;
  end loop;
end;
$$;

-- 4. Trigger to ensure every new project receives an access code
create or replace function public.trg_set_project_access_code()
returns trigger
language plpgsql
as $$
begin
  if new.access_code is null or trim(new.access_code) = '' then
    new.access_code := public.generate_project_access_code();
  else
    new.access_code := upper(trim(new.access_code));
  end if;
  return new;
end;
$$;

drop trigger if exists set_project_access_code_trigger on public.projects;
create trigger set_project_access_code_trigger
before insert on public.projects
for each row
execute function public.trg_set_project_access_code();

-- 5. RPC function to join a project via access code
create or replace function public.join_project_with_access_code(p_access_code text)
returns public.projects
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
  v_project public.projects;
  v_user_id uuid;
  v_is_member boolean;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'You must be signed in to join a project';
  end if;

  v_code := upper(trim(p_access_code));
  if v_code is null or v_code = '' then
    raise exception 'Please enter a valid access code';
  end if;

  select * into v_project
  from public.projects
  where upper(trim(access_code)) = v_code
  and not archived;

  if v_project is null then
    raise exception 'Invalid access code';
  end if;

  select exists(
    select 1 from public.project_members
    where project_id = v_project.id
    and user_id = v_user_id
  ) into v_is_member;

  if not v_is_member then
    insert into public.project_members (project_id, user_id, role)
    values (v_project.id, v_user_id, 'DEVELOPER');
  end if;

  return v_project;
end;
$$;

-- 6. RPC function for project owner to regenerate access code
create or replace function public.regenerate_project_access_code(p_project_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_project public.projects;
  v_new_code text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'You must be signed in';
  end if;

  select * into v_project
  from public.projects
  where id = p_project_id;

  if v_project is null then
    raise exception 'Project not found';
  end if;

  if v_project.owner_id <> v_user_id then
    raise exception 'Only the project owner can regenerate the access code';
  end if;

  v_new_code := public.generate_project_access_code();

  update public.projects
  set access_code = v_new_code,
      updated_at = now()
  where id = p_project_id;

  return v_new_code;
end;
$$;

-- 7. Grant execution permissions
grant execute on function public.join_project_with_access_code(text) to authenticated;
grant execute on function public.regenerate_project_access_code(uuid) to authenticated;
