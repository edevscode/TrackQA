-- RLS still permits member updates so assigned developers can advance status.
-- Enforce column-level permissions separately from the existing state machine.
create or replace function public.guard_issue_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
     or new.project_id is distinct from old.project_id
     or new.issue_number is distinct from old.issue_number
     or new.reporter_id is distinct from old.reporter_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Issue identity, project, reporter, and creation timestamp cannot be changed'
      using errcode = '22023';
  end if;

  if row(new.title, new.description, new.steps_to_reproduce,
         new.expected_result, new.actual_result, new.environment_device,
         new.environment_browser, new.environment_app_version,
         new.priority, new.assignee_id)
     is distinct from
     row(old.title, old.description, old.steps_to_reproduce,
         old.expected_result, old.actual_result, old.environment_device,
         old.environment_browser, old.environment_app_version,
         old.priority, old.assignee_id) then
    if not public.is_project_owner(old.project_id)
       and old.reporter_id is distinct from auth.uid() then
      raise exception 'Only the project owner or original reporter can edit issue details'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- BEFORE triggers run alphabetically: validate identity before the state
-- machine uses project_id or reporter_id to make authorization decisions.
drop trigger if exists trg_check_issue_update_permissions on public.issues;
create trigger trg_check_issue_update_permissions
before update on public.issues
for each row execute function public.guard_issue_update();
