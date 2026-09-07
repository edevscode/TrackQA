-- Any project member could comment or attach files on any issue, even one
-- they have nothing to do with (not the assignee, not the reporter, not
-- verifying it as QA). Scope both to how the member actually relates to the
-- issue: owner always; reporter always (it's their report); assignee always
-- (it's their work); QA while the issue is actively in QA (FOR_TESTING/
-- FAILED) or if they previously verified it. Any other member has read-only
-- access to the issue via the shared backlog.

drop policy if exists "issue_comments_insert_member" on public.issue_comments;
create policy "issue_comments_insert_member"
on public.issue_comments for insert
to authenticated
with check (
  author_id = (select auth.uid())
  and exists (
    select 1 from public.issues i
    where i.id = issue_comments.issue_id
      and i.status <> 'DONE'
      and (
        public.get_project_role(i.project_id) = 'OWNER'
        or i.reporter_id = (select auth.uid())
        or i.assignee_id = (select auth.uid())
        or (
          public.get_project_role(i.project_id) = 'QA'
          and (
            i.status in ('FOR_TESTING', 'FAILED')
            or exists (
              select 1 from public.qa_verifications qv
              where qv.issue_id = i.id and qv.qa_user_id = (select auth.uid())
            )
          )
        )
      )
  )
);

drop policy if exists "issue_attachments_insert_member" on public.issue_attachments;
create policy "issue_attachments_insert_member"
on public.issue_attachments for insert
to authenticated
with check (
  uploaded_by = (select auth.uid())
  and exists (
    select 1 from public.issues i
    where i.id = issue_attachments.issue_id
      and i.status <> 'DONE'
      and (
        public.get_project_role(i.project_id) = 'OWNER'
        or i.reporter_id = (select auth.uid())
        or i.assignee_id = (select auth.uid())
        or (
          public.get_project_role(i.project_id) = 'QA'
          and (
            i.status in ('FOR_TESTING', 'FAILED')
            or exists (
              select 1 from public.qa_verifications qv
              where qv.issue_id = i.id and qv.qa_user_id = (select auth.uid())
            )
          )
        )
      )
  )
);
