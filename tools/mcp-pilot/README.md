# TrackQA MCP pilot helpers and developer onboarding

## Current release milestone - closed 2026-11-02

The five-tool MCP service, AI Findings review and guided onboarding are deployed.
See the [current release guide](../../supabase/functions/trackqa-mcp/README.md)
and [hosted Phase 2 evidence](../../supabase/functions/trackqa-mcp/PHASE2.md).
Owners normally use production Project Settings -> AI Integrations; the helpers
below are retained for explicitly approved, bounded pilot authentication/recovery.
They are not required for ordinary developer setup and are not unattended tests.

Phase 3B used a real Google Owner and production UI to issue one connection.
Native Codex loaded the UI-generated configuration unchanged, discovered all
five tools and successfully read connection status, the authorized project and
its issues. Access lasted 11 seconds. Revocation, old-token 401 rejection,
project disablement, configuration removal and temporary Owner sign-out were
verified. All nine projects were disabled afterward with zero active connections.

The system-browser Google PKCE helper was used after automated-browser Google
login was blocked; no synthetic browser identity or mocked backend was used.
The manual terminal-paste sequence was not exercised end-to-end. Claude Code
and generic-client live verification remain deferred. No inbound abuse quota
has been verified; a public URL is not a private pilot boundary. Default token
expiry remains 90 days and short sessions require explicit revocation.

Antigravity preparation instructions later in this file describe the historical
pilot only. They are not the regular onboarding path or a request to revisit
its MCP Manager problem. None of these records authorizes activation or tokens.


## Historical four-read-tool Codex helper

The controlled hosted completion test passed using the installed Codex client:
initialization, discovery of four tools, and `trackqa_list_issues` returning the
expected synthetic issue number 1. Temporary access was revoked and all projects
disabled afterward. See the [deployment record](../../supabase/functions/trackqa-mcp/PILOT_DEPLOYMENT.md).

`codex-client.mjs` uses the installed Codex app-server's native Streamable HTTP
client. It creates an ephemeral thread, discovers only `trackqaPilot`, and calls
the four existing read tools sequentially. It starts no model turn and does not
use Antigravity's MCP Manager. The endpoint, fixture and issue are fixed to the
reviewed synthetic pilot. Client failure stops the check without retry.

The caller supplies the freshly issued token in memory. Only the Codex child
receives it through `TRACKQA_MCP_TOKEN`; it never appears in process arguments,
config files or the returned result. App-server stdout/stderr are not forwarded;
only validated tool outcomes, stage names and allow-listed HTTP status codes are
returned. The child exits after the check. Owner authorization, issuance,
revocation and project disablement remain the existing helper's responsibility.
Local configuration-only validation uses a disabled server and no token.

For a normal user setup, Codex supports this nonsecret configuration:

```toml
[mcp_servers.trackqa]
url = "https://mzeuimqfrswrwoaqjdmp.supabase.co/functions/v1/trackqa-mcp"
bearer_token_env_var = "TRACKQA_MCP_TOKEN"
enabled_tools = ["trackqa_connection_status", "trackqa_list_projects", "trackqa_list_issues", "trackqa_get_issue", "trackqa_submit_finding"]
```

An Owner must enable the intended project and approve an individual connection.
Supply that connection's token securely in the environment of the Codex process;
never commit a literal token, set a machine/user-wide token variable, or use a
Supabase database/service key. This configuration does not issue a token or grant
access itself. Remove temporary process credentials and revoke pilot connections
at completion. Configuration reference: https://developers.openai.com/codex/mcp/.

## Deployed regular developer onboarding (Phase 3A)

Project Settings → AI Integrations uses the existing Owner-only project update,
`issue_mcp_connection_token` and `revoke_mcp_connection` workflows. No migration,
new credential mechanism or browser-to-MCP connection probe is introduced. Owners
approve a named member/device; members see setup instructions and their own
RLS-visible connection metadata. The 90-day default expiry is unchanged. The
one-time dialog is memory-only and discards its token when closed, hidden or
after two minutes; metadata never contains a token/hash. A failed or uncertain
issuance is not retried automatically: inspect/revoke the new entry first.

The guide generates project-specific server/environment names from the project
UUID and derives the endpoint from the app's HTTPS Supabase URL. Prepare the
token-free configuration and start the masked terminal prompt before copying a
token. PowerShell uses `Read-Host -AsSecureString`; Bash uses `read -r -s`. The
client receives its token through a process environment variable, and the
launcher clears it on exit. No literal token is generated in a command, config
file or URL. Same-account processes and clipboard history remain relevant; use
a trusted terminal, avoid tracing/recording, and clear the clipboard after use.

Codex uses the documented `bearer_token_env_var` field in `config.toml`. Claude
Code uses `type: "http"` and a literal `Bearer ${VARIABLE}` reference in
`.mcp.json`, as documented in its
[environment expansion reference](https://code.claude.com/docs/en/mcp#environment-variable-expansion-in-mcpjson).
The guide intentionally does not generate a `--header` command that could expand
and persist a raw token. Claude Code is documented-compatible; no live Claude
connection is claimed. Generic clients need their own documented secret/env
binding: a universal config format or interpolation syntax is not assumed.

The full integration exposes four read tools plus `trackqa_submit_finding`.
The historical native Codex pilot helper above intentionally retains its
four-read-tool allowlist. Humans review findings in AI Findings; the agent has
no approval or direct issue-write tool. Access metadata is not a live client
health check: verify using `/mcp` and the two read tools shown in the guide.

Focused offline checks (existing tools only):

```powershell
node --experimental-strip-types --experimental-test-isolation=none --test tests/mcp-onboarding.test.mjs
node node_modules/typescript/bin/tsc -b
npm run build
```

Phase 3A local validation: 28 focused tests passed, plus TypeScript and the
frontend production build (existing chunk-size warning). Generated Codex TOML
was parsed with the installed Python standard library; PowerShell 5.1 launchers
were exercised with a mocked prompt/client to verify environment cleanup on
success and failure; the Bash launcher passed syntax checking. The actual setup
guide rendered without horizontal page overflow at 375px and 1440px using the
existing browser tooling with all page network requests blocked. These checks
do not claim a live Claude connection. The later Phase 3B production controls
and native Codex connection passed as recorded above; manual prompt entry remains
unverified end-to-end.

The Prepare mode below is local only. Separately approved Issue/Cleanup modes
can change the fixed synthetic fixture and its connections, as documented below;
never treat a historical test approval as authorization to run them again. No
new dependencies are used: Node 22 and Windows PowerShell 5.1 are already installed.

## Local preparation and tests

From the TrackQA repository root:

```powershell
node --experimental-test-isolation=none --test tools/mcp-pilot/*.test.mjs
node --check tools/mcp-pilot/pilot.mjs
.\tools\mcp-pilot\pilot.ps1 -Mode Prepare
```

Prepare must run only once. It atomically refuses an existing workspace instead
of overwriting it. The fixed workspace is
`C:\Users\erong\AppData\Local\TrackQA-MCP-Pilot` on this laptop. It contains:

- `.agents/mcp_config.json`: one disabled `trackqaPilot` entry, the approved HTTPS
  endpoint, four read tools, a 15-second client timeout, and **no token**.
- `pilot-state.json`: nonsecret preparation/recovery record.
- `pilot-operation.lock`: empty local file; the launcher holds an exclusive
  Windows handle to reject overlapping runs. No database lock is introduced.
- `.gitignore`: excludes the credential configuration and recovery files if
  someone later initializes a Git repository here. Never force-add these files.

The existing global `~/.gemini/config/mcp_config.json` is never read or changed
by the helper. Do not open the temporary credential file in an editor, diff,
chat, screen recording or source-control view. The raw file remains plaintext.

## Storage gate

The launcher checks a local fixed drive, refuses reparse points, and permits
only the current account, SYSTEM and Administrators in the inspected ACLs. New
directories inherit the checked parent's permissions; no ACLs are modified.
Prepare exercises actual create/read/write/delete access with a nonsecret probe.
All runtime files are checked again by the launcher. The Node worker rejects
symlinked roots/files and multiply linked files. This is conservative ACL
inspection plus an actual current-account access check, **not a complete Authz
audit, protection against privileged software, or isolation from same-account
agents/processes**. Same-account filesystem races are outside this boundary.

Before issuing anything, manually establish that this folder is excluded from
cloud sync and backup jobs, that no editor/history/recording will capture it,
and that HTTP diagnostics will not capture Authorization headers. Known
OneDrive roots are refused; their absence does not establish all exclusions.
Do not treat a File History registry key, missing sync process, LocalAppData
location, or `-StorageReviewed` flag as independent evidence of exclusion.
If exclusions cannot be established or the residual plaintext risk is not
accepted, do not issue a token. No setting is changed automatically.

## Future issuance: separate owner approval required

This is deliberately a self-bound Owner pilot: the token's user is the Owner
validated by Supabase `/auth/v1/user`; another user cannot be supplied. The
project must already be explicitly approved/enabled, named exactly
`MCP Synthetic Pilot`, unarchived, and contain only the reviewed synthetic
fixtures. The helper checks current OWNER membership. A name alone does not
prove synthetic contents; `-FixtureReviewed` records an operator assertion.

After that approval, the proposed command is:

```powershell
.\tools\mcp-pilot\pilot.ps1 -Mode Issue -ProjectId '<approved-fixture-uuid>' `
  -ApprovedRemoteChanges -StorageReviewed -FixtureReviewed
```

The launcher reads the existing public `VITE_SUPABASE_URL` and
`VITE_SUPABASE_ANON_KEY` configuration from the repository's `.env` and checks
the fixed project URL. Google is the default authentication provider. The helper
opens the system browser; select the existing TrackQA Owner's Google account.
Never enter Google credentials into this helper or chat. It does not extract
browser cookies/storage, use DevTools, transfer clipboard tokens, create an
OAuth app or change hosted redirect configuration.

The helper reuses installed `@supabase/supabase-js` 2.113.0 with
`flowType:'pkce'`, `persistSession:false`, `autoRefreshToken:false`,
`detectSessionInUrl:false` and debug logging disabled. The SDK's PKCE verifier,
flow ID, access/refresh tokens and provider response stay in process memory.
It verifies
the user with Auth, reads their own profile and current OWNER membership in
fixture `5a759e3f-50b4-4fdd-b8ad-43469a7100c0`, and checks the project's name/key.
MCP need not be enabled to authenticate. Verified Supabase MFA factors require
a separately supported flow; the helper stops rather than bypassing MFA.
The existing masked password option remains available explicitly through
`-AuthProvider Password` for accounts that support it, not Google-only accounts.

### Google PKCE callback boundary

Before opening the browser, the helper exclusively binds both `127.0.0.1:5173`
and `[::1]:5173`. The exact redirect is
`http://localhost:5173/mcp-pilot/callback`, covered by the owner-confirmed
existing `http://localhost:5173/**` allowlist. If either port binding is occupied,
the result is `callback_port_in_use`: no browser opens, and no existing Vite
server is stopped. Other listener failures are also sanitized and fail closed.

The browser first visits a one-use loopback start URL containing a random nonce,
not an OAuth credential. That route sets a transient HttpOnly, SameSite=Lax,
host-only correlation cookie and redirects to the SDK-generated Google Auth
URL. This permits the exact callback URL without adding a nonce to `redirect_to`.
The cookie contains no access/refresh token, authorization code or verifier.
Only this helper's own nonce cookie is inspected through the callback request;
existing browser credentials are never read. The callback requires this nonce,
the expected path, GET method, localhost Host, loopback peer and a permitted
Origin if present. A returned `sb_flow_id`, if present, must match the retained
SDK flow ID. Duplicated, unexpected and malformed callback parameters fail.
The SDK exchanges the code using that retained flow's in-memory verifier.

Both listeners close before exchange, or on failure, interruption or the
five-minute callback timeout. The launcher bounds the whole Google worker to
seven minutes. Callback responses contain only fixed messages, clear the
correlation cookie, and use no-store, no-referrer and restrictive CSP headers.
The helper writes no OAuth credentials, callback URLs or verifier to disk/logs.
Browser history/recovery, browser extensions, same-account malware and process
dumps remain outside its guarantees; a browser may retain the callback URL or
restore a session cookie. PKCE codes are one-use and require the memory verifier.
No browser profile settings or recovery files are changed automatically.

### Sign-in-only verification

Only after separate approval for a real sign-in and with the Owner present,
run exactly once (not during local preparation):

```powershell
.\tools\mcp-pilot\pilot.ps1 -Mode Auth -AuthProvider Google
```

Auth mode performs supported Auth sign-in/sign-out and GET verification only.
It does not enable MCP, call issuance/review RPCs, modify application records,
change the recovery phase, or write an MCP credential into the configuration.
Only fixed booleans, the fixture ID and an allow-listed result code are returned
and saved in `owner-auth-result.json` in the checked temporary workspace.
Raw provider messages, credentials, tokens and user emails are never copied
into that result. Failure returns a nonzero exit status; do not retry blindly.

Issue/Cleanup reuse this authentication wrapper and retain their original core
issuance/recovery behavior. The callback receives only a verified API closure,
not the Auth client or refresh token. In all modes the fresh session is signed
out with `scope:'local'` on success or caught failure, leaving other sessions
outside the requested sign-out scope. Auth access JWTs naturally remain valid
until expiry; no copy is retained. A failed session sign-out is explicitly
reported as `session_signout_failed`.

Password-mode credentials travel to the worker through redirected stdin, not
command arguments or environment variables. Google authentication needs no
credential input in PowerShell. The browser launcher receives only the local
bootstrap URL, never a code, token or verifier. The launcher removes inherited Node preload/debug
and proxy configuration, and uses a .NET serializer to avoid secret-bearing
PowerShell pipeline output. Node never logs raw responses/errors. Owner Auth
is verified by Supabase, not by locally decoded JWT claims. Helper Auth/API
requests use only the fixed HTTPS project endpoint and refuse redirects.
The system browser separately follows the existing Google OAuth redirects.
Auth responses are bounded to 64 KiB; the existing business API response limit
is 16 KiB. Requests time out after five seconds, and neither sign-in nor an
RPC is retried automatically.

The helper calls exactly the existing issuance contract:

```text
issue_mcp_connection_token(p_project_id, p_user_id, p_client_label)
  -> [{connection_id, access_token}]
```

It durably records project/user IDs and a unique client label **before** issuance,
then writes the token directly into the disabled MCP configuration. Only the
connection ID/status are returned. No token-bearing backup or temp file is
created. The nonsecret journal uses atomic replacement and may leave a `.next`
file after an interruption; retain both for review. Never delete recovery
metadata merely to retry issuance. Existing issued/uncertain records cannot be
automatically replayed. A new pilot requires reviewed cleanup and fresh local
preparation, not changing the recorded phase.

The configuration stays disabled. Opening Antigravity or enabling this entry is
outside this preparation approval. No OAuth/ADC provider is configured: they
cannot replace the TrackQA opaque bearer token. The client configuration fields
are documented at https://antigravity.google/docs/mcp; header interpolation and
secure references are not assumed.

## Cleanup: separate remote-change approval required

Always have an Owner cleanup session available before issuing. The proposed
cleanup command has no credentials in its arguments:

```powershell
.\tools\mcp-pilot\pilot.ps1 -Mode Cleanup -ApprovedRemoteChanges
```

The launcher removes the local credential **before** prompting for Owner Auth.
The worker validates the recorded fixture and discovers an uncertain connection
using its unique label, project and user. It calls `revoke_mcp_connection` with
the verified connection ID and checks `revoked_at`. Independently, it updates
only the recorded fixture's `mcp_enabled` to false and reads it back. Revocation
failure does not skip disablement; lost Auth does not skip local removal. The
record is retained, with `cleanup_required` and a nonzero exit code if any result
is uncertain. No automatic issuance, recovery replay or unrelated project
modification follows a failure. The helper never reports mere HTTP success as
verified cleanup. Repeat Cleanup only after inspecting the observed state.

After successful cleanup, stop Antigravity, verify the old bearer returns 401 in
the separately approved bounded pilot, clear client/clipboard copies, and
confirm the config file is absent. The nonsecret recovery record and ignore file
remain for review; no recursive directory deletion is performed. Remove those
specific files/empty directories only after cleanup is independently confirmed.
Do not edit other MCP entries, revoke browser sessions or rotate global keys.

Catchable issuance errors, write failures and observed SIGINT/SIGTERM attempt
bounded cleanup. A hard kill, Windows console termination, power loss or lost
network/Auth can prevent it. **The database expiry remains 90 days.** There is
no automatic short expiry, background watchdog or guarantee of cleanup after
process death. Recover from the journal and revoke/disable using an Owner session;
never assume deletion invalidates a token or that secure SSD erasure is possible.
JS/.NET strings and OS caches/dumps cannot be reliably zeroed by this helper.

The public function remains invocable without a verified inbound rate limit.
Revocation/disablement stops subsequent authorization, not invocation costs or
already-running requests. Emergency function deletion remains a separately
authorized operator action; this helper never deploys or deletes Edge Functions.
