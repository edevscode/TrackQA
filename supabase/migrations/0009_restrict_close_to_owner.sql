-- Any project member could close a PASSED issue to DONE, including the
-- assignee who just did the work. Restrict that final sign-off to the
-- project owner, consistent with priority/assignee edits already being
-- owner-only (see 0007).

create or replace function public.enforce_issue_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role project_role;
begin
  v_role := public.get_project_role(new.project_id, auth.uid());

  if new.priority is distinct from old.priority or new.assignee_id is distinct from old.assignee_id then
    if v_role is distinct from 'OWNER'::project_role then
      raise exception 'Only the project owner can change priority or reassign this issue';
    end if;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if v_role is null then
    raise exception 'Only project members can change issue status';
  end if;

  if old.status = 'OPEN' and new.status = 'IN_PROGRESS' then
    if v_role not in ('OWNER', 'DEVELOPER') then
      raise exception 'Only an OWNER or DEVELOPER can start work on an issue';
    end if;

  elsif old.status = 'IN_PROGRESS' and new.status = 'FOR_TESTING' then
    if v_role not in ('OWNER', 'DEVELOPER') then
      raise exception 'Only an OWNER or DEVELOPER can submit an issue for testing';
    end if;

  elsif old.status = 'FOR_TESTING' and new.status in ('PASSED', 'FAILED') then
    if v_role not in ('OWNER', 'QA') then
      raise exception 'Only an OWNER or QA member can record a QA result';
    end if;

  elsif old.status = 'FAILED' and new.status = 'IN_PROGRESS' then
    if v_role not in ('OWNER', 'DEVELOPER') then
      raise exception 'Only an OWNER or DEVELOPER can resume work on a failed issue';
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
