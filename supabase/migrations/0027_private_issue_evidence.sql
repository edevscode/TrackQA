update storage.buckets set public = false, file_size_limit = 52428800
where id = 'issue-attachments';

-- Paths are {project_id}/{issue_id}/{random_id}. Validate both IDs against
-- the real issue rather than trusting a caller-controlled project folder.
drop policy if exists "issue_attachments_member_read" on storage.objects;
create policy "issue_attachments_member_read" on storage.objects for select to authenticated
using (
  bucket_id = 'issue-attachments' and exists (
    select 1 from public.issues i
    where i.project_id::text = (storage.foldername(name))[1]
      and i.id::text = (storage.foldername(name))[2]
      and public.is_project_member(i.project_id)
  )
);

drop policy if exists "issue_attachments_member_write" on storage.objects;
create policy "issue_attachments_member_write" on storage.objects for insert to authenticated
with check (
  bucket_id = 'issue-attachments' and exists (
    select 1 from public.issues i
    where i.project_id::text = (storage.foldername(name))[1]
      and i.id::text = (storage.foldername(name))[2]
      and public.is_project_member(i.project_id) and i.status <> 'DONE'
      and (
        public.is_project_owner(i.project_id) or i.reporter_id = auth.uid()
        or i.assignee_id = auth.uid()
        or (public.get_project_role(i.project_id) = 'QA' and (
          i.status in ('FOR_TESTING', 'FAILED') or exists (
            select 1 from public.qa_verifications q
            where q.issue_id = i.id and q.qa_user_id = auth.uid()
          )
        ))
      )
  )
);

drop policy if exists "issue_attachments_owner_delete" on storage.objects;
create policy "issue_attachments_owner_delete" on storage.objects for delete to authenticated
using (
  bucket_id = 'issue-attachments' and exists (
    select 1 from public.issues i
    where i.project_id::text = (storage.foldername(name))[1]
      and i.id::text = (storage.foldername(name))[2]
      and public.is_project_member(i.project_id) and i.status <> 'DONE'
      and (owner = auth.uid() or public.is_project_owner(i.project_id))
  )
);
