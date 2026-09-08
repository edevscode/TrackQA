-- Restrict issue attachments to the issue Reporter and the Project Owner.
-- Assignees and general project members can no longer upload standalone attachments
-- to the issue to eliminate confusion and conserve storage.
-- QA engineers continue to attach verification evidence via qa_verification_attachments.

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
      )
  )
);
