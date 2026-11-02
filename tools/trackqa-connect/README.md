# TrackQA Connect — Phase 1 local baseline

Client-neutral command flow with **one implemented adapter: Codex CLI**. This is
a testing-availability choice, not a client recommendation. No package has been
published; `npx trackqa connect` is a future product interface, not a working command.

## Local usage

Use the existing repository dependencies and Node **22.19+**. No install is needed
in this checkout. From the repository root:

```powershell
node --experimental-strip-types tools/trackqa-connect/src/cli.ts --help
node --experimental-strip-types tools/trackqa-connect/src/cli.ts status --client codex
node --experimental-strip-types tools/trackqa-connect/src/cli.ts connect --client codex
node --experimental-strip-types tools/trackqa-connect/src/cli.ts disconnect --client codex
```

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
- Only the connector-owned server is added/removed using native Codex commands.
  Fingerprints and prechecks prevent silent overwrites. External edits racing a
  native command are not protected by a cross-application transaction.
- Real connect/disconnect currently support **Windows only**. The callback launcher
  is the existing Windows implementation. macOS/Linux/WSL/SSH/containers, other
  clients and OS keychains have not been validated or implemented.
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
