-- =============================================================================
-- TrackQA — Restrict invitations to emails that already have a TrackQA account
-- Paste into the Supabase SQL Editor after 0001-0003.
--
-- Why: invite_member previously allowed inviting any email address, even one
-- with no profile yet — the invitation would just sit there until (if ever)
-- that person signed up. The product decision is now that only existing
-- accounts can be invited: if the email has no profile, invite_member
-- rejects it with a clear error instead of silently creating a dangling
-- invitation.
-- =============================================================================

create or replace function public.invite_member(
  p_project_id uuid,
  p_email text,
  p_role project_role default 'DEVELOPER'
)
returns public.project_invitations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invitation public.project_invitations;
  v_email text := lower(p_email);
  v_invitee_id uuid;
  v_project_name text;
begin
  if not public.is_project_owner(p_project_id) then
    raise exception 'Only the project owner can invite members';
  end if;

  select p.id into v_invitee_id from public.profiles p where p.email = v_email;

  if v_invitee_id is null then
    raise exception 'User not found';
  end if;

  if public.is_project_member(p_project_id, v_invitee_id) then
    raise exception 'This person is already a member of this project';
  end if;

  insert into public.project_invitations (project_id, email, role, invited_by)
  values (p_project_id, v_email, p_role, auth.uid())
  returning * into v_invitation;

  select name into v_project_name from public.projects where id = p_project_id;

  perform public.create_notification(
    v_invitee_id, auth.uid(), 'INVITATION',
    format('You''ve been invited to %s', v_project_name),
    format('Join as %s. Open your pending invitations to accept.', p_role),
    p_project_id, null
  );

  return v_invitation;
end;
$$;

revoke execute on function public.invite_member(uuid, text, project_role) from anon;
