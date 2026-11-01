# MCP admission security review

Historical review of the rejected limiter. The owner subsequently chose a supervised pilot without it. The active entry and bundle now omit admission; see [PILOT_DEPLOYMENT.md](PILOT_DEPLOYMENT.md). The findings below remain the reason 0034 must stay unapplied.

Scope: the unapplied `sql-drafts/0034_mcp_request_admission.sql`, its Edge integration and local tests only. No hosted operations, credentials, authentication redesign or new infrastructure.

## Findings

| Severity | Finding | Disposition |
| --- | --- | --- |
| High | The global 60-credit burst / 5-per-second refill belongs to every well-formed attempt, not every authenticated connection. An attacker needs no valid token: repeated `Bearer tqm_<64 lowercase hex>` requests drain all credits and can consume each refill before legitimate clients. Increasing the constants does not establish fairness. | Unresolved; reproduced by an explicit regression. NO-GO for applying this as abuse protection. |
| Medium | Every well-formed attempt sends a backend admission RPC, including requests rejected with 429. Row-lock waits, PostgREST connections, request processing and Edge invocations are not rate-bounded by the credit bucket. The extra hot row can become a bottleneck. The 100ms database lock timeout and 1s HTTP deadline do not bound requests waiting for a connection or guarantee cancellation of remote SQL. | Unresolved; no total-work/availability guarantee. No per-request row-count or privilege defect found. |
| Medium | The outer gate originally ran before existing Host/Origin validation, so requests rejected by the inner handler could still consume a database call and budget. | Fixed locally: run the same SDK checks/configuration before admission; retain inner checks. Source and bundled entry regressions verify zero admission/resolver calls for rejected hosts/origins. Valid-host, absent-Origin attackers can still exhaust the global budget. |

## Correctness and security checks

- Admission happens after cheap Host/Origin and bearer-shape checks, before Web Crypto hashing, resolver access, body parsing, MCP initialization or tool execution. Missing/malformed credentials reach the existing cheap denial path without admission/database work. Malformed bodies and unsupported methods carrying well-formed credentials still reach admission and authentication; no new transport behavior was introduced for them.
- SQL uses `SELECT ... FOR UPDATE` on the sole permitted row, then samples the clock and updates the balance in that transaction. Committed calls therefore serialize on that row; there is no read/update race in the code. Refill caps at 60, fractional credits below one do not admit requests, and a backwards wall clock cannot add credits. Rollback restores a debit. The backend is expected to commit successful POST RPC transactions; hosted PostgREST dispatch/commit behavior was not tested here.
- The SECURITY DEFINER function uses a fixed `pg_catalog, public, pg_temp` path, qualified application objects, no dynamic SQL, no client arguments, one row, no loops and a 100ms lock timeout. No claim is made that this is a server-side whole-request statement deadline. The function owner remains privileged by design.
- Explicit revocations remove PUBLIC and managed browser default grants. Only `service_role` receives application-facing EXECUTE; browser roles, an unrelated role and even `service_role` cannot read or update the budget table directly in the SQL fixture. The owner/administrators retain their normal authority. Actual hosted roles and inherited grants remain unverified.
- No client IP, forwarded header, user/project identifier or token value selects a bucket. Rotating them cannot bypass a single global counter. This also means an attacker can unfairly spend legitimate clients' capacity. Do not substitute an unverified forwarded-IP header for trusted identity.
- 429 and 503 responses contain fixed text, `Cache-Control: no-store` and `Retry-After: 1`. They disclose aggregate overload/backend-health state, not token validity, user/project identities, credentials, SQL errors or connection existence. During overload the same status is returned before token eligibility is known. Existing normal 401 behavior is unchanged.

## Local verification

Executed commands use existing dependencies/tools only:

```powershell
npm --prefix supabase/functions/trackqa-mcp test
npm --prefix supabase/functions/trackqa-mcp run check
npm --prefix supabase/functions/trackqa-mcp run test:admission-sql
npm --prefix supabase/functions/trackqa-mcp run build
npm --prefix supabase/functions/trackqa-mcp run test:bundle
```

- Node MCP suite: 80 passed, including 12 admission cases.
- PGlite admission suite: 7 passed (six cases plus parent). It checks role/default grants, shared budget exhaustion, fractional/backwards-clock behavior, elapsed-time recovery/refill cap, rollback/commit accounting and missing-state failure.
- Packaging integrity: 4 passed. Generated bundle/manifest rebuilt after the integration correction.
- Existing migration structural checks: 19 passed. Original migrations and the 0034 SQL draft are unchanged.
- Deno MCP suite: the same 80 passed with cached dependencies and no network permissions. Native source/bundled entry and loopback HTTP tests: 3 passed, including 12 HTTP steps; Deno type checking passed. RPC responses/environment values are synthetic. Node type checking and JavaScript syntax checks passed.

**Not verified:** independent PostgreSQL sessions contending for the same row, actual lock-timeout behavior under contention, transaction isolation/serialization failures, PostgREST pool saturation, hosted request cancellation or flood resilience. PGlite has a single backend and serializes queued calls; `Promise.all` is not a true multi-session contention test. No unsupported test is reported as passed.

## Decision

**NO-GO for applying 0034 as the MCP endpoint's failed-authentication abuse protection.** Its accounting and privilege boundaries pass local checks, but its global budget can deny legitimate access and does not bound admission traffic itself. No small constant or ACL change fixes either property. A further limiter-specific decision/revision is needed; no authentication redesign or infrastructure change is implemented in this review. Nothing has been promoted into the migration queue or applied remotely.
