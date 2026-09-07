-- =============================================================================
-- TrackQA — Enforce "invitee must already have an account" at the table level
-- Paste into the Supabase SQL Editor after 0001-0004.
--
-- Why: invite_member (0004) checks this, but RLS's project_invitations_
-- insert_owner policy still permits a direct client-side
-- `insert into project_invitations` that bypasses the RPC entirely — so the
-- rule wasn't actually guaranteed at the database level, only by one call
-- path. Moving the check into the BEFORE INSERT trigger (which already
-- lowercases the email) makes it hold no matter how the row is inserted.
-- =============================================================================

create or replace function public.before_project_invitation_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.email := lower(new.email);

  if not exists (select 1 from public.profiles where email = new.email) then
    raise exception 'User not found';
  end if;

  return new;
end;
$$;
