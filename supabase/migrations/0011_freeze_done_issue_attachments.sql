-- 0010 froze the issues row itself once DONE, but issue_attachments insert/
-- delete had no such check, so files could still be added or removed from a
-- closed issue. Lock those down too.

drop policy if exists "issue_attachments_insert_member" on public.issue_attachments;
create policy "issue_attachments_insert_member"
on public.issue_attachments for insert
to authenticated
with check (
  uploaded_by = (select auth.uid())
  and exists (
    select 1 from public.issues i
    where i.id = issue_attachments.issue_id
      and public.is_project_member(i.project_id)
      and i.status <> 'DONE'
  )
);

drop policy if exists "issue_attachments_delete_uploader_or_owner" on public.issue_attachments;
create policy "issue_attachments_delete_uploader_or_owner"
on public.issue_attachments for delete
to authenticated
using (
  not exists (
    select 1 from public.issues i
    where i.id = issue_attachments.issue_id
      and i.status = 'DONE'
  )
  and (
    uploaded_by = (select auth.uid())
    or exists (
      select 1 from public.issues i
      where i.id = issue_attachments.issue_id
        and public.is_project_owner(i.project_id)
    )
  )
);
