# TrackQA

A QA issue tracker built with React, TypeScript, Vite, and Supabase. Issues follow
`OPEN → IN_PROGRESS → FOR_TESTING → PASSED / FAILED → DONE`, with failed issues
returning to development before another verification.

## MCP release milestone

The deployed integration supports project-scoped bearer authentication, four
read tools, AI finding submission and human QA/Owner confirmation or rejection.
Owners manage enablement and revocable connections in **Project Settings ->
AI Integrations**; reviewers use **AI Findings**. Codex live integration and the
hosted synthetic write/review path passed. Claude Code/generic live testing and
a fully manual terminal-handoff check remain deferred. The public endpoint has
no verified inbound rate limiter; UI-issued tokens default to 90 days and must
be explicitly revoked when access is no longer required.

See the [current MCP release and setup guide](supabase/functions/trackqa-mcp/README.md)
and [Phase 2 deployment/test record](supabase/functions/trackqa-mcp/PHASE2.md).
A reproducible release snapshot includes the reviewed MCP backend, lockfiles,
Supabase configuration, migrations and supporting tests/helpers. Generated
bundles, credentials and local session state remain excluded. See the release
guide for the pinned build process; committing a snapshot does not authorize
migrations, deployment or MCP activation.

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

Issue lists use Active / Completed / All, defaulting to Active. Active includes
OPEN, IN_PROGRESS, FOR_TESTING, FAILED, and PASSED; only DONE is Completed.
Scope filters run in database queries before backlog pagination. Completed issues
remain searchable through global search and retain their evidence and history.
One toolbar holds the lifecycle switch, search, and a collapsed Filters panel.
Status, priority, deadlines, sorting, and responsibility/assignee controls appear
only when expanded. Applied filters remain visible as a short summary with one
Clear action. The dashboard previews active work; its completed count opens the
completed backlog instead of repeating list filters.

My Tasks defaults to My work (assigned to or reported by the current member,
counted once). Active work is grouped into Needs your action, In progress, and
Waiting using current workflow permissions. Existing Developer reporters retain
their QA responsibility. Relationship filters and history views remain available.
Cards paginate in groups of 12; the selected scope is read in batches to avoid
silently truncating group totals at the API row limit. Sort order applies within
each responsibility group. Completed history is fetched only when selected.

Dashboard personal work stays separate from project workload. Active totals
include passed/failed issues; owners can review Unassigned work through its
backlog filter. Members' Active Queue counts exclude completed assignments.
No database migration or record relocation is needed for this organization.

- Profiles are visible to the account itself, shared project members, and pending
  invitees who need to see their inviter/project owner.
- Only project owners directly edit invitations. Recipients accept/decline through
  checked functions; acceptance preserves the assigned role.
- Member roles appear as badges. Owners manage roles in Project Settings → Member
  Roles, review the current and proposed roles, and explicitly confirm changes.
  The Members page displays roles without role-editing controls.
- New issue reports require QA or Owner membership in that project. Development
  assignments accept only Developer or Owner members; leaving an issue unassigned
  is allowed. Only the assigned Developer or Owner can start/resume development
  or submit for testing. Owner administration, issue management, and closure
  permissions remain unchanged.
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

Apply **0032_issue_responsibilities.sql** after 0031 before deploying the role
restrictions. The database enforces them for direct API writes as well as the UI.
The frontend hides reporting controls from Developers and refreshes project roles
on membership events and when the tab regains focus.

Migration 0032 does not rewrite existing reports, assignments, timestamps, or QA
history. Existing Developer reporters remain able to verify their own reports.
Legacy QA/nonmember assignments can remain unchanged during content edits;
the reporter or an Owner can reassign them to an eligible member or clear them.
QA assignees cannot perform development actions.

Reassign unresolved development issues before removing a member or moving them
to QA. Reporters with unresolved reports cannot leave/be removed; QA or Owner
reporters cannot move to Developer until their reports are finished/closed (or
deleted under existing permissions). Reporter IDs remain immutable. Roles may
still move between QA and Owner, and completed history does not block a change.

For the deadline release, apply **0028_issue_deadlines.sql** after 0027 and
then **0029_deadline_modes_and_times.sql** and **0030_user_local_deadline_timezones.sql**
before deploying this frontend.
Migration 0028 adds optional resolution/stage targets,
project timezone, workflow-managed milestone timestamps, and append-only history.
Existing issues start unscheduled; old milestone timestamps remain unknown.

Migration 0029 adds explicit No deadline / Single deadline / Stage deadlines
choices and optional times. Existing date-only targets keep
their full end-of-day commitment, including completed issues. Resolution-only
records select Single; records with stage targets select Stages. Completion
timestamps, updated_at, and old history snapshots are preserved during backfill.
Apply this transaction as a trusted database administrator; it briefly locks the
issues table while converting metadata and rebuilding the deadline views.

No deadline stores no live targets. Single requires one resolution target and
clears all stage targets. Stages supports partial milestone planning, with an
optional Close by target. Hidden draft entries survive toggling while editing;
only the selected type is saved. Editing a saved issue requires acknowledging
targets that a mode change removes. History records the old/new mode and times.

Apply **0031_due_soon_issues.sql** after 0030 before deploying the Due soon card.
It counts each unresolved issue once when its next scheduled unfinished target
falls between now and 168 hours from now. Single mode uses resolution; Stages
uses the first unfinished scheduled milestone, including an optional close target.
An overdue pending target is not skipped in favor of a later future target.
Completed and unscheduled issues are excluded. A completed-late stage may still
overlap with a future target, so dashboard counters are not mutually exclusive.
Clicking Due soon opens the matching backlog filter ordered by nearest pending
target. The same filter and ordering are available in My Tasks.

Migration 0030 uses the browser/device timezone for new deadline entry and converts
saved UTC cutoffs into each viewer's local timezone for lists, details, and history.
No project timezone setup is required. The detected timezone is visible beside the
time controls. Detection uses browser settings, without IP lookup or location access.
Existing source timezones and UTC commitments are preserved, including old end-of-day
targets. Editing another field from a different timezone does not move a saved cutoff.
Changing one target uses the editor's current timezone while untouched targets retain
their original source metadata. Old project timezone values remain for compatibility
with older clients; the current UI does not use them for scheduling.
Every supplied date/time must follow milestone order; gaps and equal cutoffs are
allowed. End of day is the last instant of the selected calendar date in the
timezone where it is entered; other viewers see that same instant converted locally.
Times can include seconds when needed to preserve a converted cutoff. PostgreSQL stores protected
UTC cutoff timestamps for comparison and sorting; clients cannot edit them.
Nonexistent or ambiguous local times during clock changes must be replaced by
an unambiguous time. Overdue indicators and counts refresh once per minute while
the app is open. Permissions and QA retry policies stay shared across deadline types.

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
partial upload retries, date ordering, timezone boundaries, deadline indicators,
rendered controls/history for each deadline type, role restrictions, and legacy
report compatibility across the responsibility migration.
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
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/deadline_modes_and_times.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/user_local_deadline_timezones.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/due_soon_issues.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/issue_responsibilities.sql
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
