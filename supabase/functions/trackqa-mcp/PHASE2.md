# Phase 2: findings and human review

**Deployed and verified.** The current release is summarized in
[README.md](README.md). This record closes the implemented write/review workflow;
it does not authorize another migration, deployment, token or live test.

## Deployed behavior

- `trackqa_submit_finding` accepts `project_id`, a stable `submission_id`
  (1-128 characters), `title` (1-240), `description` (1-8000) and `severity`
  (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`). Optional `file_path` (1-1024),
  positive ordered line numbers and `evidence_excerpt` (up to 4000) provide
  context. The total 16,384-byte HTTP body cap also applies.
- The backend passes only the privately verified token hash to a fixed RPC.
  SQL derives connection provenance and revalidates current authorization under
  row locks. Agents cannot choose the reviewer, reporter, status or issue.
- Identical connection/submission-ID/payload retries return the existing
  receipt, including after review. Changed content under the same key conflicts.
  Different connections or IDs are not semantic duplicates.
- The receipt contains only finding ID, project ID, status, issue ID and creation
  time. Evidence is inert text and is not echoed in the receipt. The four read
  tools retain their schemas; status reports finding submission available and
  direct issue writes disallowed.
- QA/Owners use the existing project **AI Findings** page with Pending Review and
  Reviewed views. Developer reads/reviews and direct browser table writes are
  denied. Evidence is not rendered as HTML, executed or opened automatically.
- Confirmation creates one normal OPEN issue, with the human reviewer as reporter,
  suggested severity as priority, no invented assignee/deadline, and normal issue
  numbering/activity triggers. Rejection creates no issue. Review identity, time,
  note and issue link are committed atomically. Terminal decisions prevent
  duplicate issues even if the linked issue is later deleted.
- Review requires current QA/Owner membership and an unarchived project. It can
  continue after connection revocation or MCP disablement. Human review execution
  is denied to the MCP backend role and rejects delegated OAuth claims.

## Completed deployment record

Target: `mzeuimqfrswrwoaqjdmp`. The approved order was migration, SQL/grant/RLS
and RPC-visibility verification, the named Edge Function, then the frontend.
There were no new secrets, services or changes to MCP authentication/RLS.

| Artifact | Reviewed/deployed identity |
| --- | --- |
| Existing foundation migration | `0033_mcp_foundation.sql`, SHA-256 `cc992ee3d731fc44c44328782942ae6d3ef9a062636023eccf06744618715451` |
| Applied findings migration | `0034_ai_findings_workflow.sql`, SHA-256 `2d7dd5deaa98286e02c577f5b398e3ed00ff1c17f71f4ace0499b8ce4531b864` |
| Edge bundle | `dist/index.js`, 466,307 bytes, SHA-256 `1f6b836cba2ecb83144795731f3886af217b4ce7c08d24f48be10c273eb40696` |
| AI Findings frontend | `d0f08ba4a297a337c69c772545bd8b479d3c8bc6` |
| Subsequent guided onboarding frontend | `932185405c474453f90c53d0fdb6c5a55fe17076` |

The applied 0034 includes transaction-local `lock_timeout = '5s'`,
`statement_timeout = '60s'` and `idle_in_transaction_session_timeout = '30s'`
immediately after BEGIN. The earlier pre-timeout checksum is superseded.
Migrations 0001-0033 must not be replayed. The rejected admission draft
`sql-drafts/0034_mcp_request_admission.sql` is unrelated and remains unapplied.

These are completed deployment facts, not a pending execution plan. Do not run
database push/history repair or redeploy from this record.

## Successful hosted synthetic smoke test

The corrected Owner-scoped preflight verified actual OWNER membership for the
fixture; it did not require an Owner's RLS-filtered project list to contain every
hosted project. Global enablement checks remained separate.

The hosted test passed submission and identical-key retry without duplication,
Pending Review and authorized visibility, Owner confirmation into exactly one
linked OPEN issue, rejection without issue creation, cross-project denial and
revoked-token rejection. Human review was performed through the
Owner-authenticated RPC. A separate fully manual browser review session is not
claimed.

Preserved, nonsecret evidence:

| Record | ID |
| --- | --- |
| Synthetic project | `5a759e3f-50b4-4fdd-b8ad-43469a7100c0` |
| Confirmed finding | `c8ba6717-fe05-4d0f-b059-6aee0b9aed66` |
| Linked OPEN issue MCPPILOT-2 | `55d2d083-e5f7-4028-974f-f193fed133ad` |
| Rejected finding | `9a390297-f044-4dd3-a2cc-5924204f819c` |
| Revoked smoke-test connection | `0c839e82-801a-47eb-972b-35961bce7057` |

The 14-second access window ended with revocation/old-token denial, project
disablement, Owner sign-out and temporary credential cleanup. Findings, the
linked issue and audit history were retained. No unrelated project/issue was
changed. Later Codex onboarding verification is recorded in the current README.

## Validation record and remaining limits

Previously executed local validation: 99 SQL-harness tests (including 34 finding
workflow cases), 117 MCP tests, 19 migration structural checks, 14 Deno HTTP steps,
5 bundle-integrity tests and 3 read-only Codex-helper tests passed. App/function
TypeScript, Deno checking and the frontend production build passed. These
historical suites were not rerun for documentation closeout.

PGlite uses PostgreSQL 18.6 and Auth/Storage stubs. The later hosted smoke test
verified the deployed PostgreSQL 17/PostgREST/gateway write path; it did not
constitute concurrent-session, load or abuse testing. There is no verified inbound
rate limit. Claude Code/generic-client live tests and a complete manual
terminal-paste onboarding check remain deferred. See the current README for
Owner setup, revocation, human review and other security boundaries.

If recovery is needed, disable MCP and revoke affected connections through the
existing Owner controls. Inspect actual database state before retrying uncertain
operations. Preserve additive schema, findings, linked issues and audit history;
do not automatically delete objects or undo reviews. Function-specific deletion
is an emergency operator action requiring explicit authority, as documented in
the current README.
