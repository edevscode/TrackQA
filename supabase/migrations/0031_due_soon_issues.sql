begin;

-- Keep one row per issue. Select the next scheduled, unfinished target before
-- applying the rolling 168-hour window; later targets cannot hide an earlier
-- overdue target. Legacy milestones already reached without timing are skipped.
create or replace view public.v_issue_deadlines with (security_invoker = true) as
select i.*,
  (i.deadline_mode <> 'none' and i.status <> 'DONE' and i.resolve_cutoff_at < now()) is true as is_overdue,
  (i.deadline_mode <> 'none' and i.status = 'DONE' and i.completed_at > i.resolve_cutoff_at) as completed_late,
  (i.deadline_mode = 'stages' and (
    ((i.work_started_at is not null or i.status = 'OPEN') and i.start_cutoff_at < coalesce(i.work_started_at, now()))
    or ((i.ready_for_qa_at is not null or i.status in ('OPEN','IN_PROGRESS')) and i.ready_for_qa_cutoff_at < coalesce(i.ready_for_qa_at, now()))
    or ((i.qa_decided_at is not null or i.status in ('OPEN','IN_PROGRESS','FOR_TESTING')) and i.qa_decision_cutoff_at < coalesce(i.qa_decided_at, now()))
  )) is true as has_missed_target,
  case when i.deadline_mode <> 'none' and i.status <> 'DONE' then i.resolve_cutoff_at end as resolution_sort_date,
  pending.next_deadline_at,
  (pending.next_deadline_at between now() and now() + interval '168 hours') is true as is_due_soon
from public.issues i
cross join lateral (
  select case
    when i.status = 'DONE' or i.deadline_mode = 'none' then null
    when i.deadline_mode = 'single' then i.resolve_cutoff_at
    when i.work_started_at is null and i.status = 'OPEN' and i.start_cutoff_at is not null then i.start_cutoff_at
    when i.ready_for_qa_at is null and i.status in ('OPEN','IN_PROGRESS') and i.ready_for_qa_cutoff_at is not null then i.ready_for_qa_cutoff_at
    when i.qa_decided_at is null and i.status in ('OPEN','IN_PROGRESS','FOR_TESTING') and i.qa_decision_cutoff_at is not null then i.qa_decision_cutoff_at
    else i.resolve_cutoff_at
  end as next_deadline_at
) pending;

create or replace view public.v_project_dashboard_stats with (security_invoker = true) as
select project_id,
  count(*) filter (where status='OPEN') as open_issues,
  count(*) filter (where status='IN_PROGRESS') as in_progress_issues,
  count(*) filter (where status='FOR_TESTING') as for_testing_issues,
  count(*) filter (where status='PASSED') as passed_issues,
  count(*) filter (where status='FAILED') as failed_issues,
  count(*) filter (where status='DONE') as done_issues,
  count(*) filter (where status='DONE' and updated_at >= date_trunc('week', now())) as completed_this_week,
  count(*) filter (where is_overdue) as overdue_issues,
  count(*) filter (where status <> 'DONE' and has_missed_target) as missed_target_issues,
  count(*) filter (where is_due_soon) as due_soon_issues
from public.v_issue_deadlines group by project_id;

grant select on public.v_issue_deadlines, public.v_project_dashboard_stats to authenticated;
notify pgrst, 'reload schema';
commit;
