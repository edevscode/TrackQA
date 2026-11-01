# TrackQA MCP

The current MCP milestone is deployed and complete as of **2026-11-02**.
TrackQA uses project-scoped opaque bearer tokens, five MCP tools, and human
QA/Owner review before a finding becomes an official issue. No further rollout
or testing is authorized by this document.

- Production application: https://trackqa.vercel.app/
- Supabase project: `mzeuimqfrswrwoaqjdmp`
- Streamable HTTP endpoint: https://mzeuimqfrswrwoaqjdmp.supabase.co/functions/v1/trackqa-mcp
- Deployed database foundation: `0033_mcp_foundation.sql` and
  `0034_ai_findings_workflow.sql`. The similarly numbered rejected admission
  draft is a different file and remains unapplied.
- Frontend release: `932185405c474453f90c53d0fdb6c5a55fe17076`
  (guided onboarding), following `d0f08ba4a297a337c69c772545bd8b479d3c8bc6`
  (AI Findings UI).
- Edge artifact: `dist/index.js`, 466,307 bytes, SHA-256
  `1f6b836cba2ecb83144795731f3886af217b4ce7c08d24f48be10c273eb40696`.
  This is the reviewed local artifact hash, not a hosted-package attestation.

## Verified workflows and deferred checks

| Area | Actual evidence |
| --- | --- |
| Hosted database and Edge integration | Applied schema/RPC/grant checks, gateway smoke checks and authenticated Codex access passed. |
| Phase 2 write path | Hosted synthetic submission, identical-key retry, Pending Review, Owner confirmation into one linked OPEN issue, rejection without an issue, cross-project denial and revoked-token rejection passed. |
| Human review UI | Deployed at AI Findings with QA/Owner access. Hosted review semantics were exercised through the Owner-authenticated RPC; a fully manual browser confirmation/rejection session is not claimed. |
| Guided onboarding | Production frontend deployment, route/asset health, 28 focused local tests, TypeScript and build passed. |
| Codex Phase 3B | A real Google Owner used the production settings controls. The unchanged UI-generated configuration loaded in native Codex app-server; five tools were discovered; connection status, project listing and issue listing succeeded for only the synthetic project. |
| Phase 3B cleanup | One connection was revoked, its old token returned 401, the fixture was disabled, temporary configuration was removed and the temporary Owner session signed out. Access lasted 11 seconds. |
| Phase 4A | Bounded source review of MCP authentication/authorization produced zero submission-ready findings; 31 focused authentication/Host/Origin tests passed. This was not a comprehensive security certification. |
| Deferred | Live Claude Code and generic-client compatibility, the complete manual masked-prompt/copy-paste onboarding sequence, and a separately observed manual review-page write session. |

Google blocked the automated browser's sign-in attempt. The existing
system-browser Google PKCE helper authenticated the real Owner for the successful
production settings test; no synthetic browser identity or mocked backend was
used. That result does not prove automated-browser Google login compatibility.

The last read-only hosted snapshot showed all nine projects MCP-disabled and
zero active connections. Synthetic findings, the linked issue and revoked
connection history were retained. This is recorded evidence, not a fresh hosted
check or a global restriction on future Owner actions.

## Owner setup and developer connection

1. Sign in to TrackQA with the existing account. Open the intended project's
   **Project Settings -> AI Integrations**. Only its Owner can enable MCP or
   issue/revoke connections. The recipient must be a current project member.
2. In **Prepare your client**, select Codex CLI, Claude Code or Other client.
   Keep existing MCP entries and copy the token-free configuration. The endpoint
   comes from the configured Supabase URL; server/environment identifiers come
   from the project's UUID.
3. For Codex/Claude, start the guide's masked terminal prompt before obtaining
   the token. It waits without putting a literal credential into a command.
   Use a trusted terminal without tracing or recording.
4. The Owner enables this project, chooses the member and a device/client label,
   then explicitly approves one connection. The token is shown once. Its default
   expiry is **90 days**; the current UI does not offer a shorter expiry.
5. Enter the token only at the waiting hidden prompt. The launched client
   inherits a process environment variable; the launcher clears its copy when
   the client exits. Use `/mcp` and the guide's connection-status/project-list
   prompt to verify the authorized project. TrackQA's access badge shows
   eligibility, not a live IDE connection.
6. Revoke access when no longer required. Never reuse the synthetic project's
   credentials or submit real findings to that fixture.

Codex uses `bearer_token_env_var` in `~/.codex/config.toml`. Claude Code uses
`type: "http"` and a literal environment reference in its Authorization header
inside `.mcp.json`. Their guide syntax was checked against official
documentation; only Codex has a live compatibility result. Generic clients must
document a secure environment/secret binding. OAuth-only clients and clients
requiring saved literal tokens are outside this guide.

References: [Codex MCP configuration](https://developers.openai.com/codex/mcp/),
[Claude Code environment expansion](https://code.claude.com/docs/en/mcp#environment-variable-expansion-in-mcpjson).

Never place a raw token in a URL, configuration file, shell command/history,
source control, screenshot, AI chat or diagnostic log. Browser login JWTs,
Supabase API keys and connection IDs are not MCP credentials. The one-time
dialog discards its displayed copy on close, page hiding or after two minutes;
this does **not** revoke the token. Clear clipboard/history after any manual
handoff. Same-account processes, process memory and recording tools remain
credential-exposure risks. Inspect/revoke an uncertain new connection before
retrying issuance; automatic issuance retries are not used.

## Available tools and human QA review

| Tool | Capability |
| --- | --- |
| `trackqa_connection_status` | Verify the authorized connection/project and a successful scoped database read. |
| `trackqa_list_projects` | Return only the connection's one approved project. |
| `trackqa_list_issues` | Read bounded issue summaries using project ID, pagination and optional status. |
| `trackqa_get_issue` | Read one issue only within the authorized project. |
| `trackqa_submit_finding` | Store a potential bug as Pending Review; never directly create an issue. |

Submission requires project ID, stable submission ID, title, description and
severity. File path, line range and evidence excerpt are optional untrusted
text. Exclude secrets and personal data. Retry an uncertain submission with the
same connection, submission ID and identical payload; changed content conflicts.
This prevents retry duplicates, not similar findings from different keys/agents.

A current QA/Owner opens **AI Findings**, selects Pending Review, checks the
evidence and optionally enters a review note. Confirm creates exactly one normal
OPEN issue, linked to the finding, with the human reviewer as reporter and
existing QA responsibility. Reject records the decision without creating an
issue. Reviewer, timestamp, note and issue link are preserved atomically.
Decisions are terminal; deleting a linked issue does not permit reconfirmation.
Review remains possible after MCP disablement/revocation if current human
permissions and the unarchived-project requirement still hold.

## Revocation, disablement and recovery

Use **Project connections -> Revoke** and confirm the exact connection. The
server records revocation; subsequent use of that token is denied. The reviewed
pilot also verified an actual 401 after revocation. No token recovery or
un-revoke operation exists.

**Disable MCP** blocks every connection for that project. Disabling alone does
not revoke tokens: re-enabling can restore eligible, unexpired connections.
For temporary sessions, revoke the issued connection, disable the project,
stop the client and remove temporary config/environment credentials. Retain
nonsecret connection IDs until cleanup is verified. Short access windows rely
on revocation, not an automatic short-lived-token or watchdog guarantee.

Unexpected traffic or a critical endpoint failure may require deletion of only
`trackqa-mcp`. The operator command below requires explicit emergency authority;
documentation is not approval to run it:

```powershell
supabase functions delete trackqa-mcp --project-ref mzeuimqfrswrwoaqjdmp --profile supabase
```

Verify the function becomes unavailable. Do not delete application records,
replay migrations, repair history or rotate unrelated credentials automatically.
Preserve findings/issues/audit history and inspect actual state before recovery.

## Security boundary and known limitations

- Every request requires strict bearer parsing, SHA-256 hashing and a checked
  resolver identity. Each data RPC independently revalidates current membership,
  approval, expiry, revocation, MCP enablement and archive state. Project/user
  arguments do not establish authorization; positive identity is not cached.
- Fixed backend RPCs enforce access; agents inherit no browser/database role.
  Credentials stay server-side. The existing `SUPABASE_SERVICE_ROLE_KEY`
  variable supports the deployed modern backend secret-key format through
  `apikey`, and legacy service-role JWTs through the existing header path.
- Only `trackqa-mcp` has `verify_jwt = false`; mandatory custom bearer
  authentication remains active. Exact public/internal Host allowlists and
  default-denied browser Origins remain enforced. Forwarded-host headers are
  not trusted. The internal gateway Host is not proof of user identity.
- The endpoint is publicly reachable. **No effective inbound/failed-authentication
  rate limit has been verified.** Invalid well-formed tokens can consume
  invocation/database resources. Platform Auth quotas/runtime limits do not
  establish an endpoint-specific abuse budget. Disabling/revoking stops data
  access, not incoming invocation costs or already-running operations.
- The rejected global PostgreSQL admission limiter remains disconnected and
  unapplied at `sql-drafts/0034_mcp_request_admission.sql`. It is not the applied
  application migration `0034_ai_findings_workflow.sql`.
- Requests are capped at 16 KiB; serialized tool results at 32 KiB; resolver
  bodies at 8 KiB and database bodies at 64 KiB. Issue pages are limited to
  1-50 rows, default 20, with offsets through 10,000. Oversized content errors
  rather than silently truncates. No persistent subscriptions are provided.
- In-memory PGlite tests use PostgreSQL 18.6 with managed-service stubs; they
  do not replace hosted PostgreSQL 17, Auth, gateway or concurrent-session
  verification. Existing hosted tests were bounded, not load/abuse tests.
- OAuth discovery, agent approval of findings and direct agent issue editing
  are not implemented. Claude/generic live tests and fully manual onboarding
  remain optional follow-ups requiring their own approval.

## Reproducible release and repository state

The official TypeScript MCP SDK `@modelcontextprotocol/server@2.4.0` and
`zod@4.6.7` are locked by `deno.lock` and the isolated npm lock.
The existing Deno 2.9.8 frozen-lock build emits self-contained `dist/index.js`;
Supabase CLI 2.116.0 uploads the configured bundle and empty import map.
The remaining runtime import is `node:process`. The upload does not itself
enforce the local lock or run the integrity check.

Local integrity-only check (no rebuild, deployment or database access):

```powershell
npm --prefix supabase/functions/trackqa-mcp run verify:bundle
```

The manifest pins input/output hashes. Documentation edits are outside the
bundle input set. A future code/dependency change requires a fresh reviewed
artifact; this milestone closeout authorizes none.

The release snapshot includes the reviewed backend, lockfiles, Supabase
configuration, migrations 0033/0034, supporting tests/helpers and their database
harness integration, alongside the deployed `9321854` frontend. Narrow Git
attributes preserve the reviewed migration line endings and MCP build-input
bytes across platforms, keeping the fingerprints reproducible. Generated bundles,
dependencies, environment credentials and local pilot/session records remain
ignored; rebuild the bundle with the pinned process rather than committing it.
The rejected admission prototype, draft and tests are retained as historical
regression/build dependencies only; the draft is outside the migration queue
and its RPC is absent from the deployed bundle. Staging or committing this
snapshot does not authorize deployment, database operations or activation.

[Phase 2 record](PHASE2.md) contains the write-path evidence and migration hashes.
[Earlier pilot history](PILOT_DEPLOYMENT.md) preserves superseded artifacts and
deployment attempts. [Pilot/helper guide](../../../tools/mcp-pilot/README.md)
documents the existing local authentication and cleanup helpers. Earlier test
counts and runbooks are historical evidence, not commands executed or deployment
authorization during this closeout.
