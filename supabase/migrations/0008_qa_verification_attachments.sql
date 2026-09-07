-- Lets QA attach evidence (screenshots, recordings, logs) to the specific
-- verification attempt it documents, instead of only a text comment/link.
-- Scoped to qa_verifications (append-only, one row per pass/fail cycle)
-- rather than the issue as a whole, so evidence stays tied to the attempt
-- it came from across multiple FAILED -> retry -> re-verify cycles.

create table if not exists public.qa_verification_attachments (
  id uuid primary key default gen_random_uuid(),
  qa_verification_id uuid not null references public.qa_verifications (id) on delete cascade,
  uploaded_by uuid references public.profiles (id) on delete set null,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  file_size_bytes integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_qa_verification_attachments_verification on public.qa_verification_attachments (qa_verification_id);

alter table public.qa_verification_attachments enable row level security;

drop policy if exists "qa_verification_attachments_select_member" on public.qa_verification_attachments;
create policy "qa_verification_attachments_select_member"
on public.qa_verification_attachments for select
to authenticated
using (
  exists (
    select 1 from public.qa_verifications qv
    join public.issues i on i.id = qv.issue_id
    where qv.id = qa_verification_attachments.qa_verification_id
      and public.is_project_member(i.project_id)
  )
);

drop policy if exists "qa_verification_attachments_insert_verifier" on public.qa_verification_attachments;
create policy "qa_verification_attachments_insert_verifier"
on public.qa_verification_attachments for insert
to authenticated
with check (
  uploaded_by = (select auth.uid())
  and exists (
    select 1 from public.qa_verifications qv
    where qv.id = qa_verification_attachments.qa_verification_id
      and qv.qa_user_id = (select auth.uid())
  )
);

drop policy if exists "qa_verification_attachments_delete_uploader_or_owner" on public.qa_verification_attachments;
create policy "qa_verification_attachments_delete_uploader_or_owner"
on public.qa_verification_attachments for delete
to authenticated
using (
  uploaded_by = (select auth.uid())
  or exists (
    select 1 from public.qa_verifications qv
    join public.issues i on i.id = qv.issue_id
    where qv.id = qa_verification_attachments.qa_verification_id
      and public.is_project_owner(i.project_id)
  )
);

-- qa_verify_issue previously returned the updated public.issues row (unused
-- by the client, which just re-fetches). It now returns the new
-- qa_verifications.id so the client can attach evidence to it. Changing a
-- function's return type requires DROP + CREATE, not CREATE OR REPLACE.
drop function if exists public.qa_verify_issue(uuid, qa_result, text, text);

create function public.qa_verify_issue(
  p_issue_id uuid,
  p_result qa_result,
  p_comment text default null,
  p_failure_reason text default null
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_verification_id uuid;
begin
  insert into public.qa_verifications (issue_id, qa_user_id, result, comment, failure_reason)
  values (p_issue_id, auth.uid(), p_result, p_comment, p_failure_reason)
  returning id into v_verification_id;

  update public.issues
  set status = case when p_result = 'PASSED' then 'PASSED'::issue_status else 'FAILED'::issue_status end
  where id = p_issue_id;

  return v_verification_id;
end;
$$;

revoke execute on function public.qa_verify_issue(uuid, qa_result, text, text) from anon;
