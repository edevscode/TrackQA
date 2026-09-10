-- QA verification (FOR_TESTING -> PASSED/FAILED) is now reserved for the
-- issue's reporter alone — not the owner, not QA-role members, no one else.
-- Only the person who filed the report can record a pass/fail result on it,
-- so it can never be rubber-stamped by whoever fixed it or by an
-- uninvolved role. Everything else here is carried over unchanged from
-- migration 0016 (reporter can manage priority/assignee, dev transitions
-- require the assigned developer, closing a passed issue is owner-only).

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
    if old.reporter_id is distinct from auth.uid() then
      raise exception 'Only the issue reporter can record a QA result';
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

drop policy if exists "qa_verifications_insert_qa_or_owner" on public.qa_verifications;
drop policy if exists "qa_verifications_insert_reporter_only" on public.qa_verifications;
create policy "qa_verifications_insert_reporter_only"
on public.qa_verifications for insert
to authenticated
with check (
  qa_user_id = (select auth.uid())
  and exists (
    select 1 from public.issues i
    where i.id = qa_verifications.issue_id
      and i.reporter_id = (select auth.uid())
  )
);
