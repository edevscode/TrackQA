# TrackQA

A QA issue tracker built with React, TypeScript, Vite, and Supabase. Issues follow
`OPEN → IN_PROGRESS → FOR_TESTING → PASSED / FAILED → DONE`, with failed issues
returning to development before another verification.

## Local development

Use Node.js 22.19 or later and npm. Run `npm ci`, copy `.env.example` to `.env`,
and set the Supabase project URL and public anon key. Cloudinary is used only
for public profile avatars; issue and QA evidence use private Supabase storage.
Never put service-role keys or Cloudinary API secrets in `VITE_` variables.

Apply `supabase/migrations/*.sql` in numeric order to your Supabase database.
For existing deployments, apply only migrations not already received. Migrations
require a trusted database administrator. Keep the QA RPC and triggers owned by
that administrator; browser roles must not own them or have schema CREATE access.

Configure Supabase email/password authentication and optionally Google OAuth.
Allow development and deployed origins as auth redirect URLs, including
`/dashboard` for OAuth and `/reset-password` for recovery. Configure email
confirmation and recovery delivery in your Supabase project's auth settings.
Run `npm run dev` to start the frontend.

## Permissions and evidence

- Profiles are visible to the account itself, shared project members, and pending
  invitees who need to see their inviter/project owner.
- Only project owners directly edit invitations. Recipients accept/decline through
  checked functions; acceptance preserves the assigned role.
- Issue ID/number, project, reporter, and creation time are immutable. Owners and
  original reporters edit content. Assigned developers perform development
  transitions. Owners or reporters can delete issues.
- Only an original reporter who remains a project member can verify an issue.
  `qa_verify_issue` locks the issue, requires `FOR_TESTING`, and commits history
  and status together. Failed verification requires a reason.
- New evidence is private and limited to 50 MB per upload by the storage bucket.
  Paths contain project and issue IDs. The client creates five-minute signed
  links and renews them while the issue page stays open. Signed links remain
  usable until they expire.
- Failed uploads remain available for retry during the current page session.
  The saved issue/result is preserved, and successful files are not re-uploaded.
  Refreshing or leaving the page discards failed File objects; select files again
  to upload later. A committed QA result is not rolled back by a file failure.
- Public avatars use a Cloudinary unsigned preset. Restrict it to image formats,
  a dedicated avatar folder, and an appropriate avatar file-size limit in the
  Cloudinary dashboard. Browser validation is not a server limit. Unsigned public
  presets allow uploads outside the app; disable the preset if not needed.

## Existing deployments

For the deadline release, apply **0028_issue_deadlines.sql** after 0027 and
before deploying this frontend. It adds optional resolution/stage targets,
project timezone, workflow-managed milestone timestamps, and append-only history.
Existing issues start unscheduled; old milestone timestamps remain unknown.

Set the project's deadline timezone in Project Settings before assigning targets.
Existing projects default to `Asia/Manila`. The timezone is locked while any issue
has targets, so changing settings cannot silently shift a delivery commitment.
Every supplied date must follow milestone order; gaps and same-day targets are
allowed. All dates run through the end of their day in the project timezone.

Owners and original reporters can set, clear, or reschedule dates before Done.
Developers keep their status transitions but cannot alter targets or measured
timestamps. A QA pass or fail records the QA decision milestone. Resuming a failed
issue increments its work cycle and clears only the current cycle's milestone
measurements; all targets stay unchanged and previous snapshots remain in history.
Dates never automatically change status or priority. Reminders are not part of
this release. Deadline history is visible to project members and follows existing
issue deletion behavior (history is deleted with its issue).

Apply migrations **0023–0027 before deploying the updated frontend**. These fix
invitation escalation, issue identity/content permissions, atomic QA, profile
visibility, owner deletion, and private evidence storage.

Existing Cloudinary evidence URLs remain supported. Making the Supabase bucket
private does not revoke public Cloudinary assets. To privatize historical evidence,
copy each asset into its real `{project_id}/{issue_id}/{random_id}` storage path,
update its attachment row, verify access as a member and outsider, then remove or
invalidate the old public asset through Cloudinary using trusted server credentials.
The browser and these schema migrations do not migrate those assets.

Storage objects do not cascade-delete with attachment rows or issues. The client
attempts file cleanup for individual attachment deletion; run an administrator-owned
orphan cleanup process for deleted issues and failed cleanup attempts. Exclude
uploads still in progress. Legacy Cloudinary deletion also needs server credentials.

Existing unauthorized memberships or inconsistent QA history are not rewritten.
Review historical owner grants, invitations, and pass/fail history before treating
an existing deployment as remediated.

## Verification

```sh
npm test
npm run lint
npm run build
```

Node tests cover account isolation, late cache responses, cache expiry/invalidation,
partial upload retries, date ordering, timezone boundaries, and deadline indicators.
They also run all application migrations and SQL regressions in embedded PostgreSQL
using PGlite (development-only). Minimal test schemas represent Supabase Auth and
Storage; actual HTTP auth, uploads, and Realtime still need a deployed smoke test.
PGlite uses one connection, so these tests do not simulate competing transactions.
TypeScript strict mode is enabled. If Windows process
restrictions prevent Vite's default config bundling, validate with:

```sh
npm exec tsc -- -b
npm exec vite -- build --configLoader native
```

Run SQL regressions as `postgres` against a **disposable Supabase database** after
all migrations. Every script rolls its fixtures back. With `psql`:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/invitation_permissions.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/issue_update_permissions.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/privacy_storage_and_deletion.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/issue_deadlines.sql
```

Browser checks: tab through each modal, close with Escape, and confirm focus returns
to its opener. Switch accounts without refreshing and confirm prior member/invitation
data does not appear. Interrupt uploads and retry. Block data requests and confirm
an error with Retry appears instead of an empty list.

## Deployment

Build output is `dist/`. `vercel.json` routes client-side paths to `index.html`.
Configure public environment variables at build time, apply pending migrations
first, and set deployed auth redirect URLs. The frontend needs no application
server or privileged credentials.
