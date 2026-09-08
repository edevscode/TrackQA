-- log_issue_activity's status/assignee CASE expressions resolved to `text`
-- instead of `activity_action` (a CASE over bare string literals with no
-- other typed input defaults to text), so any issue status or assignee
-- change failed with "column action is of type activity_action but
-- expression is of type text". Recreate the function with explicit casts
-- on every CASE branch.

create or replace function public.log_issue_activity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.issue_activity (issue_id, actor_id, action, from_value, to_value)
    values (new.id, new.reporter_id, 'CREATED', null, new.status::text);
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.issue_activity (issue_id, actor_id, action, from_value, to_value)
    values (
      new.id, auth.uid(),
      case
        when new.status = 'FOR_TESTING' then 'SUBMITTED_FOR_TESTING'::activity_action
        when new.status = 'PASSED' then 'QA_PASSED'::activity_action
        when new.status = 'FAILED' then 'QA_FAILED'::activity_action
        when new.status = 'DONE' then 'MARKED_DONE'::activity_action
        else 'STATUS_CHANGED'::activity_action
      end,
      old.status::text, new.status::text
    );
  end if;

  if new.assignee_id is distinct from old.assignee_id then
    insert into public.issue_activity (issue_id, actor_id, action, from_value, to_value)
    values (
      new.id, auth.uid(),
      case when old.assignee_id is null then 'ASSIGNED'::activity_action else 'REASSIGNED'::activity_action end,
      old.assignee_id::text, new.assignee_id::text
    );
  end if;

  if new.priority is distinct from old.priority then
    insert into public.issue_activity (issue_id, actor_id, action, from_value, to_value)
    values (new.id, auth.uid(), 'PRIORITY_CHANGED', old.priority::text, new.priority::text);
  end if;

  return new;
end;
$$;
