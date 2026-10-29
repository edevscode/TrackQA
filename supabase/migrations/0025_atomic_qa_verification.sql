-- Only the checked RPC may insert QA history. Reads and attachment policies
-- remain unchanged. Historical verification rows are not rewritten.
drop policy if exists "qa_verifications_insert_reporter_only" on public.qa_verifications;
drop policy if exists "qa_verifications_insert_qa_or_owner" on public.qa_verifications;
revoke insert on public.qa_verifications from public, anon, authenticated;

create or replace function public.qa_verify_issue(
  p_issue_id uuid,
  p_result public.qa_result,
  p_comment text default null,
  p_failure_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_issue public.issues;
  v_actor uuid := auth.uid();
  v_verification_id uuid;
begin
  if v_actor is null then
    raise exception 'You must be signed in to verify an issue' using errcode = '42501';
  end if;

  -- Serialize competing submissions before checking status. A second caller
  -- sees the committed result of the first and cannot append a duplicate.
  select * into v_issue from public.issues where id = p_issue_id for update;
  if not found or not public.is_project_member(v_issue.project_id, v_actor)
     or v_issue.reporter_id is distinct from v_actor then
    raise exception 'Only the original reporter with project membership can verify this issue'
      using errcode = '42501';
  end if;
  if v_issue.status <> 'FOR_TESTING' then
    raise exception 'Issue must be FOR_TESTING before QA verification' using errcode = '22023';
  end if;
  if p_result is null then
    raise exception 'A QA result is required' using errcode = '22023';
  end if;
  if p_result = 'FAILED'
     and (p_failure_reason is null or p_failure_reason !~ '[^[:space:]]') then
    raise exception 'A failure reason is required for FAILED verification' using errcode = '22023';
  end if;

  insert into public.qa_verifications (issue_id, qa_user_id, result, comment, failure_reason)
  values (p_issue_id, v_actor, p_result, p_comment, p_failure_reason)
  returning id into v_verification_id;

  update public.issues
  set status = p_result::text::public.issue_status
  where id = p_issue_id;

  return v_verification_id;
end;
$$;

revoke execute on function public.qa_verify_issue(uuid, public.qa_result, text, text) from public, anon;
grant execute on function public.qa_verify_issue(uuid, public.qa_result, text, text) to authenticated;

-- Intentionally SECURITY INVOKER: current_user here is authenticated for a
-- direct API update, but the trusted function owner inside qa_verify_issue.
-- An independent trigger is necessary: the existing status trigger runs as
-- SECURITY DEFINER and therefore cannot distinguish those execution contexts.
-- Only trusted database administrators may own/replace the RPC or this trigger.
-- No client-set session variable is used as an authorization token.
create or replace function public.guard_qa_status_write()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_rpc_owner name;
begin
  if new.status is distinct from old.status and new.status in ('PASSED', 'FAILED') then
    select pg_catalog.pg_get_userbyid(p.proowner) into v_rpc_owner
    from pg_catalog.pg_proc p
    where p.oid = 'public.qa_verify_issue(uuid,public.qa_result,text,text)'::regprocedure;

    if current_user is distinct from v_rpc_owner then
      raise exception 'QA results must be recorded through qa_verify_issue'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- Runs after identity validation, before the existing workflow trigger.
drop trigger if exists trg_check_qa_status_write on public.issues;
create trigger trg_check_qa_status_write
before update on public.issues
for each row execute function public.guard_qa_status_write();
