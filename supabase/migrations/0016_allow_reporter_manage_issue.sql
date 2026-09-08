-- Allow the issue's creator (reporter) as well as the project owner to
-- change priority, reassign, or update issue details before it is marked DONE.
-- Status transitions for development work (start progress, submit for testing,
-- resume work) are strictly restricted to the assigned developer (or assigned owner).
-- QA verification is role-gated (QA or Owner), and closing a passed issue is owner-only.

create or replace function public.enforce_issue_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role project_role;
begin
  if old.status = 'DONE' then
    raise exception 'This issue is done and can no longer be edited';
  end if;

  v_role := public.get_project_role(new.project_id, auth.uid());

  if new.priority is distinct from old.priority or new.assignee_id is distinct from old.assignee_id then
    if v_role is distinct from 'OWNER'::project_role and old.reporter_id is distinct from auth.uid() then
      raise exception 'Only the project owner or the issue creator can change priority or reassign this issue';
    end if;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if v_role is null then
    raise exception 'Only project members can change issue status';
  end if;

  if old.status = 'OPEN' and new.status = 'IN_PROGRESS' then
    if new.assignee_id = (select auth.uid()) and v_role in ('DEVELOPER', 'OWNER') then
      null;
    else
      raise exception 'Only the assigned developer can start work on this issue';
    end if;

  elsif old.status = 'IN_PROGRESS' and new.status = 'FOR_TESTING' then
    if new.assignee_id = (select auth.uid()) and v_role in ('DEVELOPER', 'OWNER') then
      null;
    else
      raise exception 'Only the assigned developer can submit this issue for testing';
    end if;

  elsif old.status = 'FOR_TESTING' and new.status in ('PASSED', 'FAILED') then
    if v_role not in ('OWNER', 'QA') then
      raise exception 'Only an OWNER or QA member can record a QA result';
    end if;

  elsif old.status = 'FAILED' and new.status = 'IN_PROGRESS' then
    if new.assignee_id = (select auth.uid()) and v_role in ('DEVELOPER', 'OWNER') then
      null;
    else
      raise exception 'Only the assigned developer can resume work on this issue';
    end if;

  elsif old.status = 'PASSED' and new.status = 'DONE' then
    if v_role is distinct from 'OWNER'::project_role then
      raise exception 'Only the project owner can close a passed issue';
    end if;

  else
    raise exception 'Invalid issue status transition: % -> %', old.status, new.status;
  end if;

  return new;
end;
$$;
