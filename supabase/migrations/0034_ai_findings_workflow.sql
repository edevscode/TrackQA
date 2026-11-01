begin;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL idle_in_transaction_session_timeout = '30s';

-- Evidence is inert, untrusted text. Never execute it or render it as HTML.
alter table public.ai_findings add column evidence_excerpt text
  check (evidence_excerpt is null or char_length(evidence_excerpt) <= 4000);

-- The backend supplies the verified hash; the project argument is only a scope
-- assertion. Connection provenance and authorization come from the database.
create function public.mcp_submit_finding(
  p_token_hash text, p_project_id uuid, p_submission_id text,
  p_title text, p_description text, p_severity public.issue_priority,
  p_file_path text default null, p_line_start integer default null,
  p_line_end integer default null, p_evidence_excerpt text default null
)
returns table(id uuid, project_id uuid, status text, issue_id uuid, created_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_access record;
  v_finding public.ai_findings;
begin
  if p_project_id is null or p_submission_id is null
    or char_length(p_submission_id) not between 1 and 128 or btrim(p_submission_id) = ''
    or p_title is null or char_length(p_title) not between 1 and 240 or btrim(p_title) = ''
    or p_description is null or char_length(p_description) not between 1 and 8000 or btrim(p_description) = ''
    or p_severity is null
    or (p_file_path is not null and (char_length(p_file_path) not between 1 and 1024 or btrim(p_file_path) = ''))
    or (p_line_start is not null and (p_file_path is null or p_line_start < 1))
    or (p_line_end is not null and (p_line_start is null or p_line_end < p_line_start))
    or char_length(p_evidence_excerpt) > 4000 then
    raise exception 'Invalid finding input' using errcode = '22023';
  end if;

  select * into v_access from public.resolve_mcp_connection(p_token_hash);
  if not found or v_access.project_id <> p_project_id then
    raise exception 'Connection unavailable' using errcode = '42501';
  end if;
  -- Serialize with disable/archive, membership removal and revocation. Recheck
  -- after acquiring all locks rather than trusting a previous resolver result.
  perform 1 from public.projects p where p.id = v_access.project_id for share;
  perform 1 from public.project_members m
    where m.project_id = v_access.project_id and m.user_id = v_access.user_id for share;
  perform 1 from public.mcp_connections c where c.id = v_access.connection_id for share;
  if not exists (select 1 from public.resolve_mcp_connection(p_token_hash) a
    where a.connection_id = v_access.connection_id and a.project_id = p_project_id) then
    raise exception 'Connection unavailable' using errcode = '42501';
  end if;

  insert into public.ai_findings as f
    (project_id, connection_id, submission_id, title, description, suggested_priority,
     file_path, line_start, line_end, evidence_excerpt)
  values (v_access.project_id, v_access.connection_id, p_submission_id, p_title,
    p_description, p_severity, p_file_path, p_line_start, p_line_end, p_evidence_excerpt)
  on conflict (connection_id, submission_id) do nothing;

  select f.* into strict v_finding from public.ai_findings f
    where f.connection_id = v_access.connection_id and f.submission_id = p_submission_id;
  -- A retry with the same key and payload returns the existing finding, even
  -- after review. Reusing the key for different content must never overwrite it.
  if row(v_finding.title, v_finding.description, v_finding.suggested_priority,
      v_finding.file_path, v_finding.line_start, v_finding.line_end, v_finding.evidence_excerpt)
    is distinct from row(p_title, p_description, p_severity,
      p_file_path, p_line_start, p_line_end, p_evidence_excerpt) then
    raise exception 'Submission identifier already used for different content' using errcode = '22023';
  end if;
  return query select v_finding.id, v_finding.project_id, v_finding.status,
    v_finding.issue_id, v_finding.created_at;
end;
$$;

-- Browser Supabase Auth only. Agents and service-role callers cannot review.
-- Review remains available after MCP disablement or connection revocation.
create function public.review_ai_finding(
  p_finding_id uuid, p_decision text, p_review_note text default null
)
returns table(id uuid, project_id uuid, status text, issue_id uuid, created_at timestamptz)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_project uuid;
  v_role public.project_role;
  v_finding public.ai_findings;
  v_issue uuid;
  v_description text;
begin
  if v_actor is null or auth.jwt()->>'role' is distinct from 'authenticated'
    or auth.jwt()->>'client_id' is not null then
    raise exception 'Human authentication required' using errcode = '42501';
  end if;
  if p_finding_id is null or p_decision is null or p_decision not in ('CONFIRMED','REJECTED')
    or char_length(p_review_note) > 4000 then
    raise exception 'Invalid review input' using errcode = '22023';
  end if;
  select f.project_id into v_project from public.ai_findings f where f.id = p_finding_id;
  -- Serialize confirmations with the normal per-project issue counter. Lock
  -- the project before membership/finding rows, including duplicate reviews.
  perform 1 from public.projects p where p.id = v_project and not p.archived for update;
  if not found then raise exception 'Finding unavailable' using errcode = '42501'; end if;
  select m.role into v_role from public.project_members m
    where m.project_id = v_project and m.user_id = v_actor for share;
  if v_role is null or v_role not in ('QA','OWNER') then
    raise exception 'QA or Owner review required' using errcode = '42501';
  end if;
  select f.* into strict v_finding from public.ai_findings f where f.id = p_finding_id for update;
  if v_finding.status <> 'PENDING' then
    if v_finding.status <> p_decision then
      raise exception 'Finding already reviewed' using errcode = '22023';
    end if;
    -- Terminal status, not the nullable issue link, prevents issue recreation.
    return query select v_finding.id, v_finding.project_id, v_finding.status,
      v_finding.issue_id, v_finding.created_at;
    return;
  end if;

  if p_decision = 'CONFIRMED' then
    v_description := v_finding.description;
    if v_finding.file_path is not null then
      v_description := v_description || E'\n\nReported location: ' || v_finding.file_path
        || case when v_finding.line_start is not null then ':' || v_finding.line_start::text else '' end
        || case when v_finding.line_end is not null then '-' || v_finding.line_end::text else '' end;
    end if;
    if v_finding.evidence_excerpt is not null then
      v_description := v_description || E'\n\nAI-supplied evidence (untrusted text):\n' || v_finding.evidence_excerpt;
    end if;
    -- Normal triggers generate number, human reporter, OPEN state, activity and
    -- deadline history. No assignee, deadlines or QA verification are invented.
    insert into public.issues(project_id, title, description, priority,
      steps_to_reproduce, expected_result, actual_result)
    values (v_project, v_finding.title, v_description, v_finding.suggested_priority,
      v_finding.steps_to_reproduce, v_finding.expected_result, v_finding.actual_result)
    returning public.issues.id into v_issue;
  end if;
  update public.ai_findings f set status = p_decision, reviewed_by = v_actor,
    reviewed_at = statement_timestamp(), review_note = p_review_note, issue_id = v_issue
    where f.id = v_finding.id returning f.* into v_finding;
  return query select v_finding.id, v_finding.project_id, v_finding.status,
    v_finding.issue_id, v_finding.created_at;
end;
$$;

revoke all on function public.mcp_submit_finding(text,uuid,text,text,text,public.issue_priority,text,integer,integer,text)
  from public, anon, authenticated, service_role;
grant execute on function public.mcp_submit_finding(text,uuid,text,text,text,public.issue_priority,text,integer,integer,text)
  to service_role;
revoke all on function public.review_ai_finding(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.review_ai_finding(uuid,text,text) to authenticated;

-- Explicitly cover the added column; original SELECT policies and the denial
-- of direct browser INSERT/UPDATE/DELETE from 0033 remain unchanged.
notify pgrst, 'reload schema';
commit;
