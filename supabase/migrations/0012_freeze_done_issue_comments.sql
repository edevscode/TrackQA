-- Extends the DONE freeze (0010, 0011) to issue_comments: no new comments,
-- edits, or deletes once the issue is closed.

drop policy if exists "issue_comments_insert_member" on public.issue_comments;
create policy "issue_comments_insert_member"
on public.issue_comments for insert
to authenticated
with check (
  author_id = (select auth.uid())
  and exists (
    select 1 from public.issues i
    where i.id = issue_comments.issue_id
      and public.is_project_member(i.project_id)
      and i.status <> 'DONE'
  )
);

drop policy if exists "issue_comments_update_author" on public.issue_comments;
create policy "issue_comments_update_author"
on public.issue_comments for update
to authenticated
using (
  author_id = (select auth.uid())
  and not exists (
    select 1 from public.issues i
    where i.id = issue_comments.issue_id
      and i.status = 'DONE'
  )
)
with check (author_id = (select auth.uid()));

drop policy if exists "issue_comments_delete_author_or_owner" on public.issue_comments;
create policy "issue_comments_delete_author_or_owner"
on public.issue_comments for delete
to authenticated
using (
  not exists (
    select 1 from public.issues i
    where i.id = issue_comments.issue_id
      and i.status = 'DONE'
  )
  and (
    author_id = (select auth.uid())
    or exists (
      select 1 from public.issues i
      where i.id = issue_comments.issue_id
        and public.is_project_owner(i.project_id)
    )
  )
);
