# TrackQA Connect — local Windows connector

Client-neutral command flow with **Codex CLI (live accepted)**,
**Gemini CLI (local adapter; hosted acceptance deferred by native authentication failure)**,
**Claude Code (local adapter; hosted acceptance blocked by account eligibility)**,
and **VS Code Local (experimental; Windows hosted read-only acceptance passed)**. No package has been
published; `npx trackqa connect` is a future product interface, not a working command.

## Consolidated client status

| Client | Implemented | Verification and current limit |
| --- | --- | --- |
| Codex CLI | Yes, Windows | Supervised hosted acceptance passed, including five tools, scoped reads, foreground launch, revocation and cleanup. |
| Gemini CLI | Yes, Windows; experimental | Gemini 0.66.0 isolated native configuration checks passed. Authenticated startup failed through both the connector and direct native launch; exact native exception is unknown. Hosted acceptance is deferred. |
| Claude Code | Yes, Windows; experimental | Claude 2.1.316 executable integrity, version and session-config flags were verified. Account sign-in was blocked because the test account has only the free plan. Header expansion, strict isolation, authenticated readiness and normal foreground exit remain unverified. |
| Antigravity IDE | No | IDE 2.6.0 was inspected. Safe isolation of backend, authentication and configuration was not established, so no second IDE or synthetic MCP experiment was launched. |
| VS Code Local | Yes, Windows; experimental | VS Code 1.143.1 hosted acceptance passed: five-tool discovery, all four scoped read-only calls, token revocation, fixture restoration and local cleanup. Same-session GitHub/Copilot model access passed. Write-tool execution, authentication persistence and the separate Copilot harness remain unvalidated. |

Codex CLI and Windows VS Code Local have passed supervised hosted read-only
acceptance. VS Code Local remains experimental within the limits above; Gemini
and Claude remain blocked as described. Local checks and advertised flags alone
do not establish an authenticated MCP connection. No backend, authorization or
five-tool contract changes are part of this connector consolidation.

## Local usage

Use the existing repository dependencies and Node **22.19+**. No install is needed
in this checkout. From the repository root:

```powershell
node --experimental-strip-types tools/trackqa-connect/src/cli.ts --help
node --experimental-strip-types tools/trackqa-connect/src/cli.ts status --client codex
node --experimental-strip-types tools/trackqa-connect/src/cli.ts connect --client codex
node --experimental-strip-types tools/trackqa-connect/src/cli.ts disconnect --client codex
```

## Experimental VS Code Local adapter - hosted read-only acceptance

Select `--client vscode` for connect/status/disconnect. Optional `--vscode-path`
selects an existing installed native `Code.exe`; no software is installed. Only
Windows stable VS Code **1.143.x** is accepted initially. Detection reads installed
product/package metadata and supported CLI flags without launching an editor.
It checks canonical installation paths and rechecks executable/build-input hashes
before launch. These fingerprints detect changes; they do not establish publisher
authenticity or audit every installed binary/library. Portable mode and forks fail
closed. Existing Codex, Gemini and Claude behavior is preserved.

The connector creates its own project-specific profile under
`%LOCALAPPDATA%\TrackQA-Connect\vscode-sessions\<project UUID>`. It never edits
your usual `.vscode/mcp.json`, workspace-root `.mcp.json`, Code user settings or
installed extensions. A fixed ownership marker is required before reusing this
directory. Existing unknown folders, changed settings and unexpected entries are
preserved and refused. Writes use exclusive creation and flush; a crash/partial
write is not automatically overwritten or treated as a complete installation.
Same-account external writers are not coordinated by a filesystem transaction.

The only MCP entry uses native `servers`, `type: "http"`, the fixed TrackQA URL
and `Authorization: "Bearer ${env:TRACKQA_..._VSCODE}"`. No literal token is
written. Dedicated user-data, extensions and home directories, sync off, disabled
updates/telemetry and in-memory secret storage match the isolated synthetic test.
The editor opens an empty window without a positional startup file. Native MCP
configuration remains at `user-data/User/mcp.json` and is discovered independently;
this avoids loose-file trust prompts without disabling Workspace Trust.
Environment inheritance is allowlisted; the token is supplied only to the new
editor process and its children. Existing IPC routing, provider credentials,
preloads, debug variables and TLS bypass settings are excluded. Proxy values are
potentially secret and never printed. OS-account processes/trusted subprocesses
can still inspect or inherit the environment; this is not an OS security boundary.

This is **Local harness only**, not Copilot, Codex-extension or Claude-extension
support. The new window is titled **TrackQA Local**. Use Command Palette >
**MCP: List Servers** > the displayed TrackQA server > **Start Server**. Review
server trust and **Show Output**. A discovered configuration or launched editor
does not verify MCP initialization, five-tool discovery or project access. The
connector always reports manual verification required and leaves its verification
timestamp unset. Local/model-account eligibility and enterprise policy may block
usage; no model login is automated. A new isolated profile does not inherit the
normal editor's model-account login. Local is a VS Code compatibility harness;
do not silently switch to Copilot if it is unavailable.

Use **File > Exit** to close the entire isolated instance and return to the
connector. The existing workflow revokes and reads back the connection before
removing configuration. Project-wide MCP enablement is not silently reversed.
The server's existing 90-day default expiry remains unchanged; session revocation
makes access temporary. Power loss or expired Owner authentication still requires
independent revocation in Manage Connections or `disconnect --client vscode`.

Process metadata contains only a launch phase and PID/creation-time baseline,
never tokens or raw command lines. Exit is checked using Windows process metadata,
not merely the editor's main-process exit event. Interrupt requests a graceful
close only for the identified owned main window; no forced kill runs. Remaining
owned processes, failed queries or even a newly opened unrelated Code instance
cause conservative refusal. Revocation is still attempted, configuration and
recovery metadata are retained, and no unrelated process is closed. A crash in
the spawn/acknowledgement gap retains a pending marker and requires manual process
review; do not delete `process.json` merely to bypass recovery. Other acknowledged
runs can be settled by disconnect once their process state is confirmed.

Disconnect deletes only the exact owned MCP/settings files. The ownership marker
and runtime-generated profile data are deliberately retained because they may
include user-created files; there is no recursive profile deletion. Unexpected
configuration changes retain the journal for manual review.

### Validated behavior and remaining acceptance boundary

- **Native lifecycle validated:** the integrated adapter launched its isolated
  instance, delivered a synthetic credential through the child environment,
  detected normal shutdown and removed only owned configuration. Unexpected files
  were preserved. The canonical `extensions.autoUpdate: "off"` setting avoids the
  observed boolean-to-string normalization without relaxing fingerprint checks.
- **Hosted discovery validated:** the server reached Running and exposed exactly
  `trackqa_connection_status`, `trackqa_list_projects`, `trackqa_list_issues`,
  `trackqa_get_issue` and `trackqa_submit_finding`.
- **Hosted read execution validated (Phase 4B.10):** all four read-only tools
  above ran successfully through the supervised Windows Local session. Results
  matched only the approved synthetic project and existing MCPPILOT-2. The issue
  baseline and issue/finding inventories were unchanged. Revocation, fixture
  disablement, Owner sign-out and local cleanup were verified. Automated CLI
  verification still reports manual verification required and leaves its
  timestamp unset.
- **Write execution not validated for this adapter:** `trackqa_submit_finding`
  was discovered but never invoked. Read-only acceptance does not validate
  finding submission through VS Code Local.
- **Same-session model access validated:** native GitHub/Copilot sign-in and Auto
  model execution passed in Local. Authentication persistence after restart remains
  unvalidated; keep sign-in and MCP calls in the same editor process. Model access
  and account eligibility are prerequisites, not connector-provided credentials.
  The separate Copilot harness and provider-extension integrations remain unvalidated.
- **Workspace trust remains enforced:** corrected empty-window launch and native
  profile MCP discovery passed without a new Workspace Trust approval. No
  filesystem folder was trusted. Do not automatically trust a repository or
  parent directory, or disable Workspace Trust to bypass a prompt.

Future hosted runs require fresh Owner preflight and explicit activation approval.
The connection token must be issued before editor launch for child-environment
injection; complete model sign-in and MCP execution in that same window. Explicit
fixture restoration still uses Owner controls: the connector does not restore
project-wide enablement automatically. Isolated-home browser processes can outlive
VS Code; their cleanup and scan coverage must be verified separately, preserving
unrelated browser sessions and recovery evidence on uncertainty. No acceptance
result authorizes ongoing access or bypasses model-account consent.

Phase 4B.11 consolidation checks: **183 connector tests passed, two optional native
tests skipped**, plus TypeScript, lint and CLI build. Coverage includes empty-window
launch with profile MCP configuration retained, existing Codex/Gemini/Claude
regressions, ownership checks, token-free settings and interrupted recovery.
Offline tests and supervised hosted acceptance are distinct evidence.

The supervised Phase 1 hosted acceptance test has passed. Future hosted test runs
still require separate explicit Owner authorization; this baseline is not ongoing
approval to enable projects or issue tokens. Automated tests use only mocks and
temporary homes.

Optional flags: `--project <UUID>` and `--codex-path <absolute native executable>`.
No token/password/key arguments, automatic yes flag, URL override, or alternate
Supabase project are accepted. Omitting `--client` requires an explicit selection;
there is no default. `status` is local-only and needs no Google sign-in.

The CLI uses the existing public Supabase key from `TRACKQA_PUBLIC_KEY`,
`VITE_SUPABASE_ANON_KEY`, or the app's existing `.env.local` / `.env` (source mode).
Only public anon/publishable keys are accepted. Never supply a service-role key,
database password or human access token. No environment files are written.

## Claude Code adapter — Phase 2C (experimental; authenticated acceptance blocked)

Windows native `claude.exe` only; Claude Code is not installed by the connector.
Claude 2.1.316 was independently installed and verified during approved native
checks; installation is not performed by the connector. A supervised sign-in
attempt reached the subscription requirement and was cancelled. No authenticated
readiness, cached-profile reuse or hosted acceptance succeeded. Existing user
settings were preserved. Mocked tests are not a claim of live client support.

```powershell
node --experimental-strip-types tools/trackqa-connect/src/cli.ts status --client claude
node --experimental-strip-types tools/trackqa-connect/src/cli.ts connect --client claude
node --experimental-strip-types tools/trackqa-connect/src/cli.ts disconnect --client claude --project <UUID>
```

These are local prototype commands, not authorization for a hosted session.
An independently installed Windows native CLI can be selected with
`--claude-path <absolute claude.exe>`. Detection accepts known native user/Program
Files locations, checks canonical paths and executable SHA-256, and checks the
version and `--mcp-config` help using disposable settings and working directories.
Desktop executables, npm shims, arbitrary workspace binaries and unsupported
install layouts are not selected. Runtime hash checks detect later replacement;
they do not independently establish publisher trust. No installer is run.

Installation prerequisites and commands are documented at
[Claude Code setup](https://code.claude.com/docs/en/setup). A supported native
Windows installation needs no Node package installation. Claude's own account
login must be completed separately, with explicit approval. This adapter lets
Claude use its own existing account cache (`CLAUDE_CONFIG_DIR` is preserved if
set); it does not read that cache or pass ambient Anthropic/API-provider keys.
TrackQA Google Owner authentication and Claude account authentication are separate.

Setup writes only a connector-owned temporary config at
`%LOCALAPPDATA%\TrackQA-Connect\claude-sessions\<project UUID>\settings.json`.
This is **not** Claude's user settings file. The existing private Windows writer
creates the file with a DACL for the current user, SYSTEM and Administrators,
flushes the bytes and uses a no-overwrite move. Configuration contains exactly
one `type: "http"` server, the fixed TrackQA endpoint and a literal
`Authorization: Bearer ${TRACKQA_..._TOKEN_CLAUDE}` reference. Actual tokens are
never passed to this writer. No `~/.claude.json`, repository `.mcp.json`, or
existing MCP entries are edited; no persistent native add/add-json/remove runs.

Foreground invocation uses `claude.exe --mcp-config <temporary file>`. By default
other configured MCP servers may also load. Optional **`--claude-only`** on
`connect --client claude` adds `--strict-mcp-config` only if help advertises it;
the preview explains that it excludes other MCP configurations for this session,
without deleting them. No permission-bypass or automatic-approval flags are used.

The MCP token is supplied only through the foreground child's environment, and
the launch object's token reference is removed after spawn and on failure.
Required OS, terminal, proxy/certificate and Claude configuration paths are
allowlisted. Proxy values and credentials are never printed. Debug destinations,
Node preloads, TLS bypasses and unrelated credential variables are not inherited.
`DISABLE_AUTOUPDATER=1` and `DISABLE_UPDATES=1` are session-only; user settings are
not changed. Their effective behavior still requires native verification.

Existing same-user processes and trusted client subprocesses/hooks may inspect or
inherit the session environment. Only launch in a trusted workspace with trusted
MCP entries, or explicitly choose TrackQA-only mode. Process-scoped credentials
do not constitute isolation from the operating-system account or native client.

Availability/configuration are separate from connectivity: the adapter always
reports automatic authorization and read verification as **not verified**.
Supervised native validation must confirm literal header expansion through
`--mcp-config`, no secret persistence/output, `/mcp` discovery of the existing
five tools, then only `trackqa_connection_status` and `trackqa_list_projects`
with exact project isolation. Startup or `mcp list` alone cannot prove this.
Do not submit a finding during read-only acceptance.

Normal exit uses the existing workflow to revoke the connection and read back
revocation, remove the exact temporary file and clear the Claude-specific journal.
The original project-wide MCP enablement rules remain unchanged: automatic
cleanup does not silently disable the project. Changed configs, interrupted
sessions or uncertain revocation retain nonsecret recovery metadata. Run
`disconnect --client claude --project <UUID>` using the same local recovery root;
an Owner can also revoke from Manage Connections. An exact connector payload can
be removed after a crash before its installation hash was journaled. Unexpected
content is preserved for manual review; no directory is recursively removed.
Power loss/forced termination can leave a live token until Owner revocation;
the existing default expiry remains 90 days. No token is stored for recovery.

Completed native checks verified version/help, `--mcp-config` and
`--strict-mcp-config` availability, literal references in temporary files and
preservation of existing settings. The native `mcp list` probes did not exercise
the supplied session configuration, and no loopback MCP requests were observed;
neither header expansion nor strict-mode behavior passed a runtime test.
Foreground startup reached the login chooser; one probe required bounded timeout
cleanup, so normal foreground exit is still unverified. A free claude.ai plan
does not provide Claude Code access. Separately approved eligible-account login,
authenticated readiness/reuse, local HTTP header/strict-mode checks and hosted
Owner-authorized acceptance remain necessary before claiming live support.
Reference: [MCP configuration](https://code.claude.com/docs/en/mcp) and
[CLI session options](https://code.claude.com/docs/en/cli-reference).

## Gemini CLI adapter — Phase 2B

Windows only. Existing Google Owner sign-in, project selection, explicit
enablement/issuance approvals, revocation and recovery are reused. Gemini's own
Google/API account authentication is separate and is managed by Gemini itself.
This adapter does not authenticate that account or read its cached credentials.

```powershell
node --experimental-strip-types tools/trackqa-connect/src/cli.ts status --client gemini
node --experimental-strip-types tools/trackqa-connect/src/cli.ts connect --client gemini
node --experimental-strip-types tools/trackqa-connect/src/cli.ts disconnect --client gemini --project <UUID>
```

Do not run `connect` for hosted acceptance without separate Owner authorization.
No Gemini installation or upgrade is performed. Detection checks the installed
`@google/gemini-cli` npm package in the normal Windows roaming npm or Program Files
Node installation. `agy.exe` is Antigravity CLI and is never accepted as Gemini.
An existing supported installation can be selected with `--gemini-path` pointing
to its package's actual `bin.gemini` JavaScript file (normally `dist/index.js`).
Gemini 0.66.0 uses `bundle/gemini.js`; supply that existing package bin explicitly
with `--gemini-path`, because automatic candidate discovery currently checks the
older `dist/index.js` layout. This is a detection limitation, not an instruction
to install or alter Gemini.
Custom npm prefixes, portable binaries and other packaging formats are not yet
supported. The package's bin and version metadata, canonical paths, Node runtime,
and entry/manifest hashes are checked; this is not a supply-chain audit of every
installed dependency. No Windows shell wrapper is executed: the existing Node
runtime invokes the genuine package bin with literal argument arrays.

Before Owner sign-in/foreground launch, Gemini's `general.enableAutoUpdate` must
already be explicitly `false` in its user settings, with no workspace/system
override re-enabling it. Gemini documents this option as defaulting to `true`.
The connector fails as `gemini_auto_update_enabled` instead of changing your
preferences or indirectly upgrading Gemini. Disable it through Gemini's own
settings before an integration test. Status/disconnect remain available.

Before Owner authentication, detection runs version/help/add/remove commands only
in a disposable home and working directory. It checks command flags, the generated
HTTP entry and its literal header reference. It separately records whether native
add/remove preserve unrelated settings. **Gemini 0.66.0 fails native add preservation:**
it expands an unrelated environment reference when saving the MCP map. This
unsafe result is retained, not reclassified as safe; native add/remove are never
used on the real user settings file, even for versions that pass that check.

The probe independently installs/removes an entry through the raw JSON editor in
a second temporary home, requiring unrelated settings and literal references to
survive both operations. Native command success is not proof of editor safety.
Nonexistent temporary system-policy override paths avoid loading real system
settings or pretending user-owned temporary files are administrator-owned policy.
Auto-update is explicitly false in the temporary user settings. No account sign-in,
real token, real MCP server or elevated operation is used.

Actual setup edits only `<GEMINI_CLI_HOME>/.gemini/settings.json`, defaulting to the
OS home. Only the connector's namespaced entry is inserted or fingerprint-matched
and removed. The entry uses `url` plus `type: "http"` and the literal
`Authorization: Bearer ${TRACKQA_..._GEMINI}` reference. Existing `httpUrl` entries
remain readable for recovery. No environment expansion occurs in the editor and
no native Gemini process receives configuration data or the bearer during setup.
Unrelated values/references remain unchanged; JSON indentation may be normalized.
Project/system settings are never edited. No `--trust`, automatic tool approval
or coding prompt is supplied.

Strict UTF-8 JSON objects are required. JSONC, comments, trailing commas, duplicate
keys (including escaped equivalents), BOMs, invalid UTF-8, unsafe/nonfinite numbers,
invalid MCP maps, hard-linked/symlinked settings, excessive size/depth, and redirected
`.gemini` directories fail closed. These formats are not silently converted.

The editor records original bytes/hash and file metadata, checks them again before
writing, and uses an exclusive advisory `.trackqa-settings.lock` for cooperating
writers. Windows PowerShell 5.1/.NET creates an exclusive temporary file in the same
directory, private to the user/SYSTEM/Administrators, writes and flushes it to disk,
and rechecks the original hash/metadata/permissions immediately before replacing it.
`File.Replace` preserves the existing DACL/owner/group; new files use the private
DACL. NTFS may add the informational DACL auto-inherited bit without changing ACEs
or protection; that bit alone is excluded from the permission comparison. There is
no delete-then-rename or truncate-in-place fallback. The helper receives settings
only over stdin, never command arguments or diagnostic output; it needs no admin
privileges, extra software or PowerShell profile.

**This is optimistic concurrency, not race-free compare-and-swap.** Close other
settings writers during setup/removal. Pre-commit changes are refused; a final
non-cooperating rename race can only be detected afterward using the replaced
file's backup preimage. Successful writes delete the backup. On failure the
original normally remains intact; if replacement left the destination absent,
the helper attempts a no-clobber move of its backup to restore it. It never rolls
back over an existing unexpected file. Conflicting/uncertain results fail closed,
retain recovery metadata and any `.trackqa-settings-recovery-*.bak`, and are not
retried. Review/compare/merge that backup with `settings.json` before any recovery;
it can contain the same pre-existing unrelated secrets as the original, so never
print, upload or commit it. A timeout or process crash may also leave a private
`.tmp` and `.trackqa-settings.lock`; inspect the lock's helper PID and remove only
a stale lock after confirming that process has exited. Do not delete recovery
metadata or reset the whole settings file.

The foreground process alone receives the issued MCP token in its environment.
It inherits the terminal and normal Gemini approval behavior. Normal `/quit`,
launch failure and handled interruption return to the existing revocation and
owned-entry cleanup. Hard termination/power loss still requires independent
`disconnect`; the database's existing 90-day expiry is unchanged. No project-wide
enablement reversal is performed implicitly.

**Verification is deliberately distinct:** native CLI compatibility and matching
configuration are checked automatically. `gemini mcp list` is not a five-tool
discovery/read test, so it is not run against all the user's servers. In the
foreground session, `/mcp` must show the five TrackQA tools; only connection status
and project listing should be called for acceptance. The connector provides that
checklist but does not machine-verify the interactive results, claim authorization
or save a successful verification timestamp. Installed Gemini 0.66.0 passed
isolated configuration and unauthenticated foreground startup checks, but native
Google authentication did not reach readiness, including on a direct native run.
The launcher network-environment correction is regression-tested; it is not a
proven fix for that native failure. Environment substitution over an actual HTTP
transport, five-tool discovery and scoped reads remain unverified. No further
login retry or hosted acceptance is implied by this baseline. Process startup
alone is never a successful MCP connection.

Codex names/environment references and existing recovery records are unchanged.
Gemini has separate names/references and a `geminiHome` record field. Journal
identity is `(client, project)`; disconnect/status select only that client's
records, including when another client's unresolved record exists for the project.
The existing single-session lock remains; parallel multi-client launch is not
implemented.

Local native compatibility test after an independently approved installation:
set `TRACKQA_NATIVE_GEMINI` to the package bin path and run the connector tests.
The opt-in test runs only the temporary-home native capability and raw-editor probe. It does not
enable MCP, issue tokens or connect to TrackQA. Without an installed Gemini CLI,
the automated suite uses isolated fake npm-bin subprocesses and mocks; these
fixtures are not evidence of real Gemini acceptance.

References: [Gemini MCP](https://geminicli.com/docs/tools/mcp-server/),
[settings and environment references](https://geminicli.com/docs/reference/configuration/),
[native HTTP add implementation](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/commands/mcp/add.ts),
[native list implementation](https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/commands/mcp/list.ts).

## Codex foreground compatibility

Detection prefers a trusted native CLI installation over an editor-bundled binary;
`--codex-path` remains an explicit selection, never a request to install or replace it.
When `--help` advertises `--no-daemon` and `--no-daemon --help` accepts it, the
connector uses that flag for the interactive session. This avoids the shared
background server and the incomplete-package startup failure of the tested editor
bundle. MCP configuration and app-server verification commands are unchanged.

An editor bundle without a supported foreground mode is rejected before Google
authentication or token issuance. Local status and disconnect remain available.
A non-bundled CLI without this flag retains its direct launch path. No failed
interactive launch is retried automatically. The terminal is inherited unchanged;
`TERM=dumb` can still cause a client warning and is not silently overridden.

The selected `0.164.0-alpha.11.1` bundle passed isolated startup testing and the
supervised authenticated foreground acceptance retry with `--no-daemon`. Both
exited successfully. Help/capability checks alone are not a live connection test.

## Verified Phase 1 acceptance

Supported and verified scope: **Windows, Codex CLI, Owner-operated setup, and
session-based credentials**. On 2026-11-02, the supervised acceptance retry passed:

- Google Owner PKCE authentication, profile and exact-project Owner verification.
- Token-free native MCP configuration and exactly one project-scoped connection
  for the existing MCP Synthetic Pilot project.
- Real Codex transport initialization, all five tools discovered, and successful
  read-only `trackqa_connection_status` and `trackqa_list_projects` calls confirming
  only the intended project. No findings or coding tasks were submitted.
- Actual foreground TUI startup using `--no-daemon`; `/mcp` displayed the TrackQA
  server connected with five tools; normal `/quit` and CLI exit code 0.
- Confirmed server-side revocation, test entry removal, temporary Auth sign-out,
  and cleared nonsecret recovery records and lock.
- Original project enablement restored to false, zero active connections, and
  unchanged issues, findings, memberships and unrelated project settings.

The acceptance supervisor separately restored the fixture's disabled state using
existing Owner controls and restored the original local configuration from a
private encrypted backup outside the repository. These are supervised test cleanup
steps, **not automatic CLI features**: the CLI revokes its connection and removes
its own entry, but does not disable the project or restore a whole configuration
backup. Codex itself can also add TUI preferences during startup.

This verifies the local Windows/Codex MVP, not npm distribution, other clients or
other operating systems. No credentials, private backups, session files or raw
acceptance logs are included in this package.

## Example onboarding

1. Detect a trusted native Codex installation and check command capabilities.
2. Confirm Google sign-in. The existing system-browser PKCE helper binds both
   loopback interfaces on port **5173** before opening the browser. A busy port
   fails closed; no process is stopped and no redirect settings are changed.
3. Verify the Google user's identity/profile. Choose from **their unarchived
   Owner projects**, not a global project inventory. Membership is checked again.
4. Review the endpoint, server name, configuration location and token-free native
   installation command. Confirm before any configuration is added.
5. If necessary, separately confirm project enablement, then separately approve
   exactly one connection for the signed-in Owner and this client.
6. Discover all **five** tools using the real Codex app-server transport where
   supported. Call only `trackqa_connection_status` and `trackqa_list_projects`,
   validating the exact project. No model turn or finding submission is started.
7. Launch Codex in the foreground with the MCP token only in its child environment.
   Exit normally to attempt server-side revocation and remove the managed entry.

The environment may be inspectable by other trusted processes on the same OS
account. A later normal Codex launch will not inherit the token. No token is saved
in TOML, a launcher, recovery metadata or shell history.

**Project enablement is persistent and explicitly approved.** Ending this session
revokes only its own connection; it does not disable a shared project or revoke
other developers' connections. The CLI explains this before enablement. Owners
can disable project access separately in the existing TrackQA UI.

## Accurate status and verification

- **Configured:** the current native Codex entry matches the installation fingerprint.
- **Authorized:** a read-only status tool call succeeded for the exact project.
- **Verified working:** Codex discovered five tools and completed both scoped reads.

`status` never performs a live probe or calls authentication endpoints. It reports
authorization and connectivity as **not checked**, and labels any saved verification
timestamp as historical. Configuration alone is never reported as a connection.
If this Codex version lacks the probed app-server mode, connect offers manual
`/mcp` and read-tool verification and keeps its automated result **unverified**.
Any automated authorization, discovery or scope failure aborts and enters cleanup.

## Disconnect and recovery

Recovery files contain only project/user/connection IDs, a unique client label,
the executable/configuration paths, phase and configuration fingerprint. They are
stored outside the checkout:

- Windows: `%LOCALAPPDATA%\TrackQA-Connect\connections.json`
- Future POSIX location: `$XDG_STATE_HOME/TrackQA-Connect`, or
  `~/.local/state/TrackQA-Connect` (live POSIX authentication is not supported yet).

Run `status`, then `disconnect --client codex --project <UUID>` after an interrupted
session. Disconnect uses fresh Google Owner authentication, checks current Owner
membership, and permits revocation even if the project is disabled or archived.
It verifies `revoked_at` or absence of a known connection ID. Local removal is not
proof of revocation. Already-revoked/absent known connections are handled safely.

If issuance times out, never issue again automatically. The unique nonsecret label
allows the connection to be located and revoked. If no row is visible yet, the
outcome remains **unknown** and the recovery record is retained. An Owner can also
find and revoke the labeled connection in AI Integrations → Manage Connections.

An entry edited after installation is preserved rather than overwritten/deleted.
Review that specific entry manually; never reset the whole Codex configuration.
An interrupted native installation before its fingerprint is saved may also need
manual removal after review. No credential has been issued at that stage.

One local `connector.lock` prevents competing connector sessions. After an OS crash,
inspect its nonsecret PID and independently confirm the process is gone before
removing **only that lock file**. Never delete a live session's lock or the recovery
record. Disconnect can then be retried explicitly.

## Security and platform boundaries

- Existing Supabase Google PKCE is reused, not replaced. No OAuth provider,
  background service, MCP proxy or new hosted component is implemented.
- Human Auth access/refresh/provider tokens and PKCE values remain in memory;
  only the human API closure reaches the workflow. Local-session sign-out and
  memory cleanup are attempted on every exit. MFA accounts fail closed as unsupported.
- SDK/API errors and captured probe diagnostics are not echoed; CLI errors use an
  allowlist. The foreground client owns its normal terminal output and may have
  its own logging behavior; do not enable
  credential tracing/recording. JavaScript memory clearing is best effort, not
  guaranteed secure erasure. Crash dumps and hostile same-account processes are
  outside this prototype's guarantees.
- The existing token RPC's **90-day expiry is unchanged**. Revocation on exit is
  attempted and checked. Power loss, forced termination, lost network or expired
  human sessions can prevent it. The record and Owner UI are the recovery path.
- Only trusted native executable locations are accepted; repository/download/temp
  binaries and Windows shell shims are refused. Explicit paths do not bypass this.
  The executable SHA-256 is rechecked before commands. This detects replacement,
  not publisher authenticity; trusted installation permissions remain an OS premise.
- Only the connector-owned configuration is managed: Codex uses native commands,
  Gemini uses the scoped JSON editor, Claude uses a private temporary session
  file, and VS Code uses a dedicated isolated profile with exact owned files.
  Fingerprints and prechecks prevent silent overwrites. External settings
  writers are not coordinated by a cross-application transaction.
- Real connect/disconnect currently support **Windows only**. The callback launcher
  is the existing Windows implementation. macOS/Linux/WSL/SSH/containers and OS
  keychains have not been validated. Only Codex/Gemini/Claude/VS Code Local adapters exist;
  Antigravity and all other clients remain unimplemented.
- npm packaging/publishing, member approval, permanent credential storage and
  automatic reconnection are outside Phase 1. This standalone local CLI reuses
  source modules and installed dependencies from the checkout.

## Validation commands

```powershell
npm --prefix tools/trackqa-connect test
npm --prefix tools/trackqa-connect run check
npm --prefix tools/trackqa-connect run lint
npm --prefix tools/trackqa-connect run build
npm --prefix tools/trackqa-connect start -- --help
```

The build uses the existing TypeScript compiler and includes the reused helper
modules under this package's ignored `dist/`. Compiled mode requires the public
key environment variable; it does not copy the application's environment files.

Optional offline native-command test: set `TRACKQA_NATIVE_CODEX` to the independently
checked native executable path and run the tests. It uses a disposable `CODEX_HOME`
and loopback-only fixture URL, no real token, and checks that add/remove do not even
contact that fixture. This is **not** the hosted real-client acceptance test.

Before any future separately approved acceptance: ensure port 5173 is free, select one explicitly
authorized project, supervise Google sign-in and permission prompts, and verify
five-tool discovery, both reads, actual foreground launch and confirmed revocation.
The completed hosted acceptance above is distinct from these local/mocked checks.
