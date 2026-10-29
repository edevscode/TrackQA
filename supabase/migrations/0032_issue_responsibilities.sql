begin;

-- Keep reporter identity and the existing workflow/owner permissions intact.
-- Membership row locks serialize creation/assignment with role changes/removal.
create function public.guard_issue_responsibility()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.project_role;
begin
  if tg_op = 'INSERT' then
    select role into v_role from public.project_members
    where project_id = new.project_id and user_id = auth.uid()
    for share;
    if v_role is null or v_role not in ('QA', 'OWNER') then
      raise exception 'Only QA testers and project owners can report new issues'
        using errcode = '42501';
    end if;
  elsif new.assignee_id is not distinct from old.assignee_id then
    -- Preserve existing assignments when editing unrelated fields, including
    -- legacy assignments to QA members. They can be reassigned by the owner/reporter.
    return new;
  end if;

  if new.assignee_id is not null then
    select role into v_role from public.project_members
    where project_id = new.project_id and user_id = new.assignee_id
    for share;
    if v_role is null or v_role not in ('DEVELOPER', 'OWNER') then
      raise exception 'Assign development work to a developer or owner in this project'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_check_issue_responsibility
before insert or update of assignee_id on public.issues
for each row execute function public.guard_issue_responsibility();

drop policy issues_insert_member on public.issues;
create policy issues_insert_qa_or_owner
on public.issues for insert to authenticated
with check (public.get_project_role(project_id) in ('QA', 'OWNER')
  and reporter_id = (select auth.uid()));

-- Changing role or leaving/removing a member must not strand open work.
-- QA ownership is still reporter-based, including reports filed before this
-- migration. Do not rewrite reporter IDs or historical verification evidence.
create function public.guard_member_responsibility()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.project_role;
begin
  if tg_op = 'UPDATE' then
    if row(new.id, new.project_id, new.user_id) is distinct from
       row(old.id, old.project_id, old.user_id) then
      raise exception 'Membership identity and project cannot be changed'
        using errcode = '22023';
    end if;
    v_role := new.role;
    if new.role = old.role then return new; end if;
  else
    -- Let project deletion cascade normally; the project row is already gone.
    if not exists (select 1 from public.projects where id = old.project_id) then
      return old;
    end if;
  end if;

  if (v_role is null or v_role not in ('DEVELOPER', 'OWNER')) and exists (
    select 1 from public.issues where project_id = old.project_id
      and assignee_id = old.user_id and status <> 'DONE'
  ) then
    raise exception 'Reassign this member''s unresolved development issues before changing their role or removing them'
      using errcode = '23514';
  end if;

  if (tg_op = 'DELETE' or (old.role in ('QA', 'OWNER') and v_role = 'DEVELOPER')) and exists (
    select 1 from public.issues where project_id = old.project_id
      and reporter_id = old.user_id and status <> 'DONE'
  ) then
    raise exception 'This reporter must finish or close their unresolved issues before changing their role or leaving the project'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger trg_check_member_responsibility
before update or delete on public.project_members
for each row execute function public.guard_member_responsibility();

revoke all on function public.guard_issue_responsibility() from public, anon, authenticated;
revoke all on function public.guard_member_responsibility() from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
