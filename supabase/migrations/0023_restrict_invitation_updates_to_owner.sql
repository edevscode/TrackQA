-- Invitees must not edit invitation roles, project IDs, expiry, or status
-- directly. accept_project_invitation and decline_project_invitation already
-- validate the recipient and perform their updates as SECURITY DEFINER.
-- Keep direct updates available only to project owners.
drop policy if exists "project_invitations_update" on public.project_invitations;

create policy "project_invitations_update"
on public.project_invitations for update
to authenticated
using (public.is_project_owner(project_id))
with check (public.is_project_owner(project_id));
