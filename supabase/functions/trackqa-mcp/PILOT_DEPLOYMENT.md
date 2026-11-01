# TrackQA MCP release and historical pilot record

## Current milestone closed - 2026-11-02

The deployed release has five tools, including finding submission and human
QA/Owner review. [README.md](README.md) is the current capability/setup/security
reference; [PHASE2.md](PHASE2.md) records the successful hosted write-path test.
The current Edge bundle SHA-256 is
`1f6b836cba2ecb83144795731f3886af217b4ce7c08d24f48be10c273eb40696`.
The guided onboarding frontend is production commit `9321854`.

Phase 3B verified real Google Owner membership, production UI enablement and
one-time issuance, unchanged UI-generated Codex configuration, native Codex
initialization, all five discovered tools, and authorized connection/project/issue
reads. The synthetic project's two issues were visible and other projects were
excluded. Connection `c6ea214c-a728-4cb9-bf37-1ca9c8aa49e3` was revoked after an
11-second active window; its old token returned 401. The fixture was disabled,
the temporary configuration removed, the Owner session signed out and the
isolated browser closed. A read-only independent check confirmed all nine
projects disabled, zero active connections and unchanged issue/finding counts.

Google rejected sign-in inside the automated browser. The existing system-browser
PKCE helper supplied a real Owner session for the successful production UI test;
no backend/browser fixtures were used. The complete manual masked-prompt handoff
was not exercised. Claude Code and generic-client live tests remain deferred.
The fixed 90-day UI token expiry was not changed; immediate revocation bounded
access. No verified inbound rate limiting or private endpoint is claimed.

Phase 4A reviewed the bounded MCP authentication/authorization path with no
submission-ready findings. No real finding was submitted and no non-synthetic
destination project was selected. This milestone introduces no subsequent phase.

## Historical Phase 1 material below

All artifact hashes, four-tool inventories, role/project counts and proposed
commands below belong to earlier checkpoints. They are retained as history,
not current deployment instructions or unexecuted release work. In particular,
references to an unapplied `0034` below mean the rejected request-admission draft,
not the now-applied `0034_ai_findings_workflow.sql`. Do not replay these procedures.


## Historical Codex completion patch — deployed and verified

The previous authenticated attempt logged `resolve_mcp_connection` with
`code: configuration`. Read-only inspection confirmed that the hosted reserved
service-role variable contains the project's existing modern `sb_secret_` key.
The transport rejected every `sb_` key before making an RPC request.

The narrow correction accepts well-formed backend secret keys, sends them only
through `apikey`, and retains the legacy JWT header path. Publishable/malformed
keys remain rejected. MCP opaque bearer authentication, connection/project
authorization, Host/Origin checks, four tools and migrations are unchanged.
Supabase's [API-key guidance](https://supabase.com/docs/guides/getting-started/api-keys)
specifies `apikey` for modern keys, which are not JWTs.

Prepared artifact: `dist/index.js`, 464,025 bytes,
SHA-256 `d43080c78e83dde82b62156f2b95a044ec1947066e64d74b888e90703c1dc67a`.
The frozen lock is unchanged. Focused validation passed: 50 RPC/bearer/client
tests; the existing Deno HTTP harness's 14 steps, including the installed Codex
client discovering four tools and calling `trackqa_list_issues` with synthetic
backend responses; the built-bundle entry test; and TypeScript checking.
A narrowly scoped hosted SELECT-only resolver probe using an invalid synthetic
hash returned HTTP 200 and no connections with the corrected header format.
No MCP token was issued and no hosted resource was changed during preparation.

After explicit approval, only `trackqa-mcp` was deployed as ACTIVE version 2
using the existing API path:

```powershell
supabase functions deploy trackqa-mcp --project-ref mzeuimqfrswrwoaqjdmp --profile supabase --use-api
```

The controlled live Codex test passed initialization, discovery of exactly four
tools, and one `trackqa_list_issues` call retrieving the expected synthetic issue
number 1. The installed native Codex app-server client performed these operations
against the deployed HTTPS endpoint, not a mocked endpoint or model assertion.
Its token was supplied only through the Codex child environment and never written
to a credential file. Connection `5ccad7ab-3cd0-49e3-8231-2524836f93f9` was then
revoked, and its old token returned HTTP 401. All nine projects were confirmed
MCP-disabled, all three historical pilot connections revoked, zero AI findings,
and unchanged application data fingerprints and migration history. The temporary
configuration was removed, callback listeners closed, and Owner session signed
out. Nonsecret results are retained at
`%LOCALAPPDATA%/TrackQA-MCP-Pilot/Codex-Completion/codex-result.json`.
No migrations, new authentication system or unrelated hosted changes were made.
The historical artifact details below describe the previously deployed revision.

At the earlier preparation checkpoint, the first inactive deployment had succeeded and then been deleted after SDK Host validation failed. Its endpoint returned 404. The compatibility revision described below was still pending at that checkpoint; it was subsequently deployed and superseded by the successful Codex and Phase 2 releases recorded above. The historical preflight itself made no hosted writes. Any new redeployment or pilot still requires separate approval.

## Reviewed artifact

| Item | Value |
| --- | --- |
| Target project | `mzeuimqfrswrwoaqjdmp` |
| Function | `trackqa-mcp` |
| Entry artifact | `supabase/functions/trackqa-mcp/dist/index.js` |
| Size | 463,928 bytes |
| Artifact SHA-256 | `4493377df1cef9fbcc44d38d57dc3825057c8c380bbe01bc462f8545fc107068` |
| Input/output manifest | `supabase/functions/trackqa-mcp/dist/manifest.json` |
| Manifest SHA-256 | `d6331071503dff1f36ebb950068de641f9520622a9adbe15ee23e10f813ca473` |
| Frozen Deno lock SHA-256 | `23b2d941843ab7f2e1208b52d0e4cfa8d485befb1da337b751a534b6a86f2890` |
| Build/runtime tools | Existing Deno 2.9.8, Supabase CLI 2.116.0 |
| Deployment import map | `supabase/functions/trackqa-mcp/deploy.imports.json` (empty) |
| Remaining runtime import | `node:process` only; no hosted npm or HTTP dependency resolution |
| Function configuration | Only `[functions.trackqa-mcp]`: `verify_jwt = false`, bundled entry, empty import map |

These hashes describe the local JavaScript and manifest, not a hosted ESZIP/package attestation. Two frozen builds produced byte-identical artifact and manifest. `dist/` is ignored; rebuild it on a fresh checkout. Keep the reviewed source, lock and build version unchanged, verify immediately before deployment, and stop on any mismatch.

Run bundle tamper tests sequentially with builds/module-loading tests: they intentionally change and restore the generated artifact. Do not deploy while any build or integrity test is running.

## Active security boundary

`index.ts` serves `createDatabaseEndpoint(options).fetch` directly. Existing inner SDK Host/Origin checks, strict bearer parsing, SHA-256 hashing, verified resolver identity, project isolation and four read tools remain unchanged. Runtime access is limited to `resolve_mcp_connection`, `mcp_list_projects`, `mcp_list_issues`, and `mcp_get_issue`. The privileged key remains server-side and is never an IDE credential.

## Host compatibility evidence and boundary

The configured public project hostname was the sole allowed hosted hostname. `createDatabaseEndpoint` passes that list to `createEndpoint`, which runs the SDK's `hostHeaderValidationResponse` and `originValidationResponse` before bearer authentication, hashing or RPC access. The SDK checks the actual `Host` header; it does not use the public request URL or forwarded-host headers for this check. Only after those checks and verified identity does `createMcpHandler` dispatch the four tools.

The hosted missing-auth response was 403 with a 103-byte body and SHA-256 `8f38bb00fb3f5aea80418513ea82e687ae9c4471f964f1f8e79b81ecf1a9008d`. A local SDK rejection for `edge-runtime.supabase.com` exactly matched that digest. Supabase's [official logging example](https://supabase.com/docs/guides/functions/logging) also shows this internal Host. Its [gateway/runtime architecture](https://supabase.com/docs/guides/functions) is consistent with the upstream hop replacing the public authority. The exact hosted proxy configuration and a contractual guarantee across regions/future releases are not established here; the value is documented in an example and confirmed for this deployment, not an identity credential.

The smallest compatibility change adds only `edge-runtime.supabase.com` beside the configured public hostname in `index.ts`, and only when `SUPABASE_URL` is configured. Generic endpoint defaults remain loopback-only. No wildcard, arbitrary `.supabase.com` suffix, dynamically learned hostname, forwarding-header override or Origin exception is used. Hostnames retain the SDK's existing case/port normalization. A small raw-authority syntax guard rejects userinfo, paths, escapes and similar malformed values before the SDK's URL parser can normalize them into an allowlisted hostname.

This shared internal hostname does not identify a project, user or trusted client, and cannot attest the original external Host after proxy rewriting. Bearer authentication, independently scoped database authorization and default-deny browser Origins remain necessary. `Forwarded` and `X-Forwarded-Host` provenance is unverified, so they are ignored; a forged value cannot repair an untrusted Host/Origin or authorize a request. Malicious DNS names remain rejected, and trusting the internal Host does not allow a browser Origin with the same name. If Supabase changes the internal Host, the function fails closed until reviewed again.

Production changes are limited to `index.ts` (one exact hosted alias) and `handler.ts` (raw Host authority syntax). Tests changed in `tests/gateway-host.test.ts` (new), `deno-tests/entrypoint-fixture.ts` and `deno-tests/http_test.ts`. This runbook and `README.md` record the resulting artifact and evidence. Build code, configuration, dependencies, locks and migrations remain unchanged.

The rejected admission factory/prototype remain only as historical source/test material. They are not imported by the entry point and are removed from its bundle. The new packaging regression requires the output to contain no `admit_mcp_request`, `mcp_request_budget`, `0034` draft name or SQL-draft path. No static assets are configured. The draft stays outside `supabase/migrations`; neither deployment nor build runs SQL. Original migrations 0001-0033 and the 0034 draft are unchanged.

Missing/malformed/unknown credentials return generic 401; well-formed expired/revoked/ineligible credentials are rejected by the resolver. Each read repeats database authorization. With every project MCP-disabled, even an otherwise valid existing token returns no resolver identity or read rows, and Owner issuance is denied. An in-flight read may finish after disablement; no positive authorization is cached for later requests.

## Executed local verification

| Suite | Result |
| --- | --- |
| Complete Node function tests | 87 passed (68 original protocol/authentication/data, 7 Host regressions, 12 retained rejected-limiter regressions) |
| Same tests under Deno, cached/frozen, no network permission | 87 passed |
| Source entry, bundled entry and loopback HTTP tests | 3 passed, including 13 HTTP steps |
| PGlite baseline/application/MCP SQL runtime tests | 64 passed; migrations 0001-0033 only |
| Migration structural checks | 19 passed (83 combined with SQL runtime suite) |
| Bundle integrity/configuration/exclusion tests | 5 passed |
| Historical admission SQL regressions (disposable PGlite only) | 7 passed; 0034 remains unapplied remotely and excluded from the bundle |
| Node TypeScript, native Deno type checks and JavaScript syntax | Passed |
| Repeated frozen build | JavaScript and manifest byte-identical |
| Bundle execution with empty cache and npm/remote imports disabled | Passed; no network permissions |

The source and bundle tests stub environment values and every RPC. They permit only the original four operations, exercise initialization/discovery and all four tools using the internal Host, and deny missing, invalid, expired, revoked, disabled, removed-member and archived states. Public and internal Hosts reach the exact custom 401 challenge for unauthenticated clients. Host lookalikes, malformed authorities, missing Hosts and untrusted Origins fail before RPC access; forged forwarding headers have no authority. The real HTTP test uses Deno's documented `allowHost` test-client option and checks the Host headers received by its loopback server, rather than relying on fetch's default ignored Host override. This is test-only and does not relax server validation. A disable between initial authentication and read cannot return healthy status. The SQL suite separately executes the real expiry/revocation/eligibility logic, including a test with all projects disabled and no admission RPC: both synthetic connections, all read RPCs and Owner issuance are denied.

PGlite is PostgreSQL 18.6 with managed Auth/Storage/roles stubbed; it is not the hosted PostgreSQL 17 environment. Mock denial labels are not a substitute for SQL execution. Real PostgREST dispatch, Edge gateway forwarding, platform-injected secrets and hosted compilation remain untested by these suites. The existing non-fatal Deno legacy `request.signal` warning remains.

## Deployment procedure, after separate approval only

Second-attempt preflight completed on **2026-10-31 at 22:13:51 Asia/Manila** (14:13:51 UTC), without deployment. Read-only project API metadata confirmed `mzeuimqfrswrwoaqjdmp` / TrackQA / ACTIVE_HEALTHY, and the function inventory was empty. The verified Psycopg connection used existing credentials, `sslmode=verify-full`, autocommit and a fixed SELECT-only query; no CLI database initialization or temporary credential issuance ran. All 8 projects were MCP-disabled; total/active connections and findings were zero; migration history was exactly 0001-0033; both 0034 admission objects were absent. All 31 role names matched the audited inventory, and `cli_login_postgres` attributes/memberships matched the previous verified state. The artifact/manifest and the exact bundled entry point above passed local verification. This is a point-in-time snapshot: refresh the read-only checks immediately before a separately approved deployment. This preflight did not issue tokens, enable projects, retrieve individual application records, or modify hosted configuration.

1. Refresh the target identity independently and confirm migration 0033 remains installed, all hosted projects have MCP disabled, no connections exist, and no connection will be issued or enabled as part of deployment. The latest verified snapshot is recorded above; it does not replace an immediate pre-deployment check. Use the inspected Psycopg client and existing credentials through the owner-confirmed session pooler, with verified TLS and fixed SELECT-only queries. Do not use CLI database initialization: the installed CLI can provision temporary login credentials when a password is absent. Leave `cli_login_postgres` unchanged.
2. Confirm the intended function does not overwrite an unrelated existing deployment. Review this artifact and local configuration. Required names are platform-injected `SUPABASE_URL` and legacy `SUPABASE_SERVICE_ROLE_KEY`; do not print values or upload `.env`. No new secrets are required. Their effective runtime availability still needs an approved hosted check.
3. From the repository root, using the existing tools, verify the artifact and stop if the command fails:

```powershell
npm --prefix supabase/functions/trackqa-mcp run verify:bundle
if ($LASTEXITCODE -ne 0) { throw 'STOP: pilot artifact verification failed' }
```

4. Only with explicit deployment approval, the exact proposed command is:

```powershell
supabase functions deploy trackqa-mcp --project-ref mzeuimqfrswrwoaqjdmp --profile supabase --use-api
```

Use existing CLI 2.116.0; do not upgrade or use `--prune`, deploy all functions, run `db push`, push global configuration or change secrets. This operation deploys only the named function and its reviewed per-function gateway configuration. It does not apply 0034. See the [official deploy command](https://supabase.com/docs/reference/cli/supabase-functions-deploy).

5. After an approved deployment, run the bounded inactive smoke plan below. Do not issue a real token to get a positive read during this inactive deployment step. Positive hosted reads remain a later, separately approved pilot action.

### Bounded second-attempt smoke plan (not executed)

Use `https://mzeuimqfrswrwoaqjdmp.supabase.co/functions/v1/trackqa-mcp`, one sequential POST per case, a 12-second client timeout and a 2 KiB response-body cap. Use a small MCP `tools/list` request, no browser session/service key, no live MCP credentials, no redirects and no automatic retries. Stop immediately on unexpected data, successful unauthenticated tool execution or a critical runtime/authentication failure. At most five requests are planned; there is no load test or agent activation.

| Case | Expected evidence |
| --- | --- |
| Missing Authorization | 401, exact generic authentication error, `WWW-Authenticate: Bearer realm="trackqa-mcp"`, `Cache-Control: no-store`; no inventory/project/issue data. This must reach custom authentication rather than repeat the previous internal-Host 403. |
| Malformed bearer | Same generic 401/challenge/no-store response; no tool or data response. |
| Well-formed, synthetic unissued bearer | Same generic 401; no real credential issuance. Do not print or retain Authorization values, and do not treat this denial alone as proof that the backend key is configured correctly. |
| Untrusted Origin, e.g. `https://trackqa-smoke.invalid` | Expect the SDK's 403 if the gateway delivers the Origin unchanged. Distinguish the known SDK response from gateway-level rejection. If the gateway strips/changes the header or prevents attribution, mark hosted Origin coverage unverified rather than passed and investigate before pilot activation. Never add an allowed Origin to make this pass. |
| Optional malicious external Host | Keep the TLS connection/SNI and URL on the approved project and send one `Host: trackqa-smoke.invalid` override using a client that actually permits it. Gateway rejection demonstrates ingress rejection only. If the gateway rewrites it to the known internal Host and the function returns its generic 401, this does **not** demonstrate application rejection of arbitrary received Hosts. Record that limitation; the application's actual-Host protection is covered by local source/bundle and real-HTTP regressions. Do not trust forwarded-host headers or create an alternate hostname/route to force this test. |

Inspect the deployed metadata for only this function, its reviewed bundled entry and `verify_jwt=false`; confirm runtime startup and the exact custom challenge, then repeat the Psycopg state snapshot. Require all projects still disabled, zero connections, no 0034, and unchanged role/membership metadata. No successful authorization or browser-Origin exception is expected during this inactive step. Generic denial must not be reported as proof of a successful authenticated database read; that remains part of a separately approved synthetic pilot.

## Immediate deletion and recovery

For unexpected traffic or a failed smoke check, the proposed function-specific shutdown command, requiring the owner's explicit emergency authority, is:

```powershell
supabase functions delete trackqa-mcp --project-ref mzeuimqfrswrwoaqjdmp --profile supabase
```

It removes only the remote named function, leaving local files, application tables, migration history and other functions intact. Confirm the command succeeds and verify the function is absent/unavailable after propagation; already-running work is not guaranteed to stop retroactively. See the [official delete command](https://supabase.com/docs/reference/cli/supabase-functions-delete).

During a later active pilot, also have the Owner revoke its connection using the existing `revoke_mcp_connection` RPC and set the pilot project's `mcp_enabled` to false. Those controls stop future data access, not invocations, so use function deletion for traffic/boot problems. Keep migration 0033; do not roll back tables, change global credentials, pause the whole TrackQA project or repair history. Redeployment requires a reviewed artifact and separate approval. Keep any revoked token revoked.

## Recommendation and residual risks

**GO from local readiness for a separately approved redeployment of the inactive endpoint**, subject to confirming the inactive target preconditions above and approving this new artifact checksum. No known local implementation or packaging blocker remains. The exact internal Host is covered by source, bundled-entry and real HTTP regressions, but this fix has not run hosted. This is not deployment approval or proof of hosted execution; repeat the bounded inactive smoke checks and the function-specific shutdown procedure on any failure before considering activation.

The URL is publicly reachable. Ordinary browser sessions/anonymous keys cannot authenticate as MCP connections, but arbitrary clients can send requests and generate invocation costs; well-formed bad tokens also generate resolver/database work. There is no verified pre-function failed-token quota, hard per-pilot request budget or private network boundary. Existing Owners retain their project permissions; this is not a global pilot-user allowlist. Deployment while disabled still exposes that traffic risk on the shared application project. Activation remains limited to a separately approved supervised session, synthetic-only project and individually revocable connection. Existing token issuance defaults to 90 days, so a short pilot window requires explicit end-of-session revocation/disablement.
