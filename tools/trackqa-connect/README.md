# TrackQA Universal Connector — Windows MVP release candidate

Connect an existing AI coding client to TrackQA's remote MCP server without copying
bearer tokens or editing MCP configuration manually. Codex CLI is the MVP-supported
candidate. Setup is Owner-operated, with explicit project approval and session-based
credentials. The connector does not install or authenticate the AI client itself.

## Package status and installation

**trackqa@0.1.0** was published and independently verified on November 4, 2026.
The locally prepared **v0.1.1 candidate** removes manual public-key setup for the
official hosted TrackQA service. **v0.1.1 is not published; publication requires
separate approval.** The original v0.1.0 artifact is retained unchanged.

To verify an approved local tarball in a disposable directory:

```powershell
npm install --ignore-scripts --no-audit --no-fund <absolute-path-to-trackqa-0.1.1.tgz>
npm exec --offline -- trackqa --help
```

After v0.1.1 is approved and published, the official hosted workflow is:

```powershell
npx trackqa connect
# Explicit client selection is also supported:
npx trackqa connect --client codex
npx trackqa status --client codex
npx trackqa disconnect --client codex --project <project-UUID>
```

Until v0.1.1 is published, the bare registry command still resolves to v0.1.0 and
retains that version's manual public-key requirement. Validate this candidate
through a local tarball installation and `npm exec --offline -- trackqa ...`.
Bare `connect` prompts for a client; `--client codex` is optional. No client is
selected by default.

## Requirements and first use

- Windows, Node.js **22.19 or newer**, npm and an interactive terminal.
- An independently installed, compatible Codex CLI and its own account access.
  The connector never installs, upgrades or signs into an AI client automatically.
- A TrackQA account with a profile and **OWNER** membership in the selected project.
  Google PKCE sign-in is interactive in the system browser. Accounts with verified
  MFA factors are currently refused as unsupported.
- Free callback port **5173** on localhost. Stop a conflicting development server
  through its own terminal before setup; the connector never terminates it.
- Official hosted TrackQA's validated **public anon key is included**. No manual
  `TRACKQA_PUBLIC_KEY` setup, application checkout or `.env` file is required.

```powershell
npm exec --offline -- trackqa connect --client codex
```

The installed package uses its included shared runtime helpers; it does not need
the application checkout or its environment files. Source-checkout fallback to the
app's public-key setting is development-only. No `.env` file is packaged or created.

### Advanced: custom public configuration

The connector continues to pin its backend URL. A custom deployment uses a custom
build pinned to its own backend, with a matching public key supplied through
`TRACKQA_PUBLIC_KEY` or, alternatively, `VITE_SUPABASE_ANON_KEY`. A key override
alone does not change the destination. No runtime URL override was added.

```powershell
$env:TRACKQA_PUBLIC_KEY = '<matching-deployment-public-anon-or-publishable-key>'
```

Explicit environment values take precedence over the development-file fallback
and official default. Invalid explicit values fail closed. Legacy anon JWTs with
a different project reference are rejected; opaque publishable keys cannot be
associated with a deployment offline and must be validated by that backend.
The official default is never used for a different pinned deployment. Never use
a secret/service-role key, database password, Owner session or MCP bearer token.

Select one client and one project, inspect the token-free preview, and approve
installation, project MCP enablement if needed, and one scoped connection. The
connector launches the client with the credential only in the child environment.
TrackQA Owner sign-in and any Codex/GitHub/Google/Claude AI-account sign-in are
separate. Normal interactive tool approvals remain in effect.

## Support and validation limits

| Client | Status |
| --- | --- |
| Codex CLI | **MVP-supported candidate**, Windows and Owner-operated. Hosted initialization, five tools, scoped reads, foreground launch, revocation and cleanup passed. |
| VS Code Local (`vscode`) | **Experimental**. Windows hosted read-only acceptance passed. Manual MCP activation and same-session model access are required. |
| VS Code Copilot (`vscode-copilot`) | **Experimental and guarded**. Hosted read-only acceptance passed through the separate fixture-pinned test entry. Ordinary `connect` still stops before Owner authentication, issuance or launch. |
| Gemini CLI | **Experimental; hosted validation deferred**. Local/native configuration checks passed; native Google authentication remains blocked. |
| Claude Code | **Experimental; hosted validation deferred**. Native installation/configuration flags checked; test-account eligibility blocked authenticated acceptance. |
| Antigravity | **Deferred**; no adapter. Safe isolation remains unverified. |

VS Code detection currently supports Windows stable 1.143.x. Other platforms,
portable/forked clients, additional providers and parallel multi-client sessions
are outside this MVP. Use `trackqa --help` for supported executable-path flags.
Claims about a client apply only to the validated scope above.

On **November 4, 2026**, the isolated Copilot run against MCP Synthetic Pilot reached
Running, discovered five tools and successfully called `trackqa_connection_status`,
`trackqa_list_projects`, `trackqa_list_issues` and `trackqa_get_issue` once each. Four
native Search Tools operations were permitted; no unrelated application tools,
delegated agents or `trackqa_submit_finding` invocation were recorded. Project
isolation, revocation, fixture restoration, unchanged inventories and owned MCP
configuration removal were verified. The credential-pattern scan covered 166 files
with zero matches or exclusions.

Write-tool execution, authentication persistence, normal editor exit and complete
detached Agent Host/SDK termination remain unvalidated. The status response reported
`read_only=false` and `issue_writes_allowed=false`: the acceptance procedure used
only reads; the existing token's finding capability was not removed. Findings still
follow TrackQA's existing human QA review workflow. Ordinary Copilot activation is
not enabled by these results. Hosted acceptance scripts are not shipped.

## Credentials, disconnect and recovery

Owner PKCE/session credentials remain in memory and local sign-out is attempted on
exit. MCP tokens are never placed in arguments, configuration, logs or recovery
records. Configuration contains only the literal environment reference. Other
trusted processes on the same OS account may inspect a child's environment.

**The existing 90-day token expiry is unchanged.** This is session-based delivery,
not a short-lived token guarantee. Normal exit, handled interruption or explicit
Disconnect attempts revocation and independently checks the server record. A hard
kill, power loss or network failure can prevent cleanup; local configuration removal
alone does not revoke access.

Recovery metadata is stored in `%LOCALAPPDATA%\TrackQA-Connect`, outside the checkout.
After an interrupted session:

```powershell
npm exec --offline -- trackqa status --client codex
npm exec --offline -- trackqa disconnect --client codex --project <project-UUID>
```

`status` is local-only and does not prove authorization or connectivity. Disconnect
may require fresh Google Owner sign-in. Failed or uncertain issuance/revocation
retains actionable recovery metadata; do not bypass it or issue another connection
automatically. An Owner can also revoke the labeled connection in TrackQA's existing
AI Integrations → Manage Connections controls.

Only unchanged connector-owned configuration is removed. Edited entries and
unexpected files are preserved. Remove a stale `connector.lock` only after confirming
its recorded process has exited. Do not delete pending recovery evidence.

Normal session cleanup does **not** silently disable project-wide MCP or revoke
other users' connections. Any project enablement is persistent and explicitly
approved. Synthetic acceptance restoration was a separate, authorized Owner action.

## Package contents and source development

The artifact contains this README, package metadata and the exact compiled runtime
dependency closure. It includes the existing PKCE/shared MCP helper and the internal
acceptance-capability guard required by authentication/workflow imports. That guard
is not an acceptance runner or a synthetic server. Its behavior is unchanged.

Source, tests, hosted/synthetic runners, fixture servers, development tooling,
obsolete WMI supervision modules, environment files and runtime profiles are excluded.
No install scripts run on consumers. The declared runtime dependency is
`@supabase/supabase-js@2.113.0`; build tooling stays in the source checkout.

Source developers use the repository's existing dependencies:

```powershell
npm --prefix tools/trackqa-connect run check
npm --prefix tools/trackqa-connect run lint
npm --prefix tools/trackqa-connect run build
npm --prefix tools/trackqa-connect test
```

Build clears only the verified owned `dist` directory, compiles the CLI and shared
dependencies, and checks the exact runtime allowlist. `prepack` repeats that clean
build when packing from the source checkout. Preserve generated tarballs/checksums
under the ignored `artifacts/` directory. Historical implementation and supervised
acceptance procedures remain in source-only `DEVELOPMENT.md`; no new hosted run or
publication is authorized by this documentation.
