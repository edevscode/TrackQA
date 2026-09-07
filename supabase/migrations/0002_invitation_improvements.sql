-- =============================================================================
-- TrackQA — Invitation improvements
-- Paste into the Supabase SQL Editor after 0001_init.sql.
--
-- What changed and why:
--   1. invite_member now rejects inviting someone who is already a project
--      member (previously it would silently create a second, redundant
--      pending invitation for them).
--   2. invite_member now creates a real in-app notification for the invitee
--      IF they already have a TrackQA account (matched by email) — before
--      this, an invitation was invisible until the invited person happened
--      to open /projects/join themselves.
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

  if v_invitee_id is not null
     and public.is_project_member(p_project_id, v_invitee_id) then
    raise exception 'This person is already a member of this project';
  end if;

  insert into public.project_invitations (project_id, email, role, invited_by)
  values (p_project_id, v_email, p_role, auth.uid())
  returning * into v_invitation;

  if v_invitee_id is not null then
    select name into v_project_name from public.projects where id = p_project_id;

    perform public.create_notification(
      v_invitee_id, auth.uid(), 'INVITATION',
      format('You''ve been invited to %s', v_project_name),
      format('Join as %s. Open your pending invitations to accept.', p_role),
      p_project_id, null
    );
  end if;

  return v_invitation;
end;
$$;

revoke execute on function public.invite_member(uuid, text, project_role) from anon;
