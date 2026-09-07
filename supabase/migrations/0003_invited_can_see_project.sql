-- =============================================================================
-- TrackQA — Let an invited (not-yet-a-member) user see the project they were
-- invited to.
-- Paste into the Supabase SQL Editor after 0001_init.sql and 0002.
--
-- Why: projects_select_member (from 0001) only allows project *members* to
-- read a project row. An invited person isn't a member yet, so the embedded
-- `projects(name, key)` join on their pending invitation came back null,
-- which is why /projects/join was rendering "Unknown project" instead of
-- the real name. Multiple SELECT policies on one table are OR'd together in
-- Postgres RLS, so this only *adds* visibility — it doesn't touch or weaken
-- projects_select_member.
--
-- profiles is already readable by any authenticated user (profiles_select_
-- authenticated: using (true), from 0001), so the inviter's and the
-- project owner's name/email need no additional policy — only the project
-- row itself was blocked.
-- =============================================================================

drop policy if exists "projects_select_invited" on public.projects;
create policy "projects_select_invited"
on public.projects for select
to authenticated
using (
  exists (
    select 1 from public.project_invitations pi
    where pi.project_id = projects.id
      and pi.status = 'PENDING'
      and pi.email = lower((select auth.jwt() ->> 'email'))
  )
);
