-- Use a recursion-safe helper so profile joins do not recurse through RLS.
create or replace function public.can_view_profile(p_profile_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and (
    p_profile_id = auth.uid()
    or exists (
      select 1 from public.project_members mine
      join public.project_members theirs on theirs.project_id = mine.project_id
      where mine.user_id = auth.uid() and theirs.user_id = p_profile_id
    )
    or exists (
      select 1 from public.project_invitations invitation
      join public.projects project on project.id = invitation.project_id
      where invitation.email = lower(auth.jwt() ->> 'email')
        and invitation.status = 'PENDING' and invitation.expires_at > now()
        and p_profile_id in (invitation.invited_by, project.owner_id)
    )
  );
$$;
revoke execute on function public.can_view_profile(uuid) from public, anon;
grant execute on function public.can_view_profile(uuid) to authenticated;

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated" on public.profiles
for select to authenticated using (public.can_view_profile(id));

drop policy if exists "issues_delete_authorized" on public.issues;
drop policy if exists "issues_delete_owner" on public.issues;
create policy "issues_delete_authorized" on public.issues
for delete to authenticated
using (
  public.is_project_member(project_id)
  and (reporter_id = auth.uid() or public.is_project_owner(project_id))
);
