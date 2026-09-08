-- Allow only the creator/reporter (the one who created/assigned the task) to delete it

drop policy if exists "issues_delete_owner" on public.issues;
drop policy if exists "issues_delete_authorized" on public.issues;

create policy "issues_delete_authorized"
on public.issues for delete
to authenticated
using (
  reporter_id = auth.uid()
);
