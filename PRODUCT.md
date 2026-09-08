# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Dedicated QA engineers, software developers, and engineering leads.
- **QA Engineers:** Logging reproducible defects, specifying exact environment parameters, running verification passes, and providing explicit pass/fail sign-offs.
- **Developers:** Triaging assigned issues, reproducing bugs with provided specs, pushing fixes, and submitting tickets for QA re-testing.
- **Project Owners / Leads:** Monitoring QA execution progress, managing team access, and ensuring release readiness.

## Product Purpose

TrackQA is a dedicated quality assurance workbench and issue management platform designed to replace bloated trackers with a fast, precision-oriented testing workflow. Success means zero ambiguity in bug reports, rapid triage, and explicit, verifiable QA sign-offs before shipping code.

## Positioning

Unlike generic issue trackers where QA workflows are an afterthought or a custom plugin, TrackQA treats the QA verification loop as a first-class citizen: structured reproduction steps, expected vs. actual results, environment manifests (device, browser, app version), and formal QA verification records (Pass / Fail with failure reasons and attachments).

## Operating Context

- Used in rapid agile sprints, test cycle runs, and pre-release regression passes.
- Operating environments: modern desktop browsers during dev/QA testing, with responsive mobile views for quick review and triage.
- High-frequency daily usage: scanning tabular backlogs, filtering by status/priority/assignee, reviewing reproduction evidence, logging comments, and transitioning ticket states.

## Capabilities and Constraints

- **Multi-Project Workspace:** Projects have distinct keys (e.g., `TQA-101`), access codes for joining, owner controls, and project archiving.
- **Role-Based Workflows:** Distinct permissions and responsibilities for `OWNER`, `DEVELOPER`, and `QA`.
- **First-Class QA Verification:** Issues track lifecycle `OPEN` -> `IN_PROGRESS` -> `FOR_TESTING` -> `PASSED` / `FAILED` -> `DONE`. Formal verification captures verification result (`PASSED`/`FAILED`), failure reason, notes, and screenshot/log attachments.
- **Real-Time Synchronisation:** Instant updates on notifications, task assignments, and status transitions via Supabase real-time subscriptions.
- **Technical Constraints:** Built with React 19, TypeScript, Vite, Tailwind CSS v4, and Supabase backend.

## Brand Commitments

- **Name:** TrackQA
- **Voice:** Direct, technical, authoritative, and concise. No generic marketing fluff ("streamline", "frictionless", "supercharge").
- **Identity:** Precision Lab & Technical Workbench. Clean typography, high contrast, crisp functional borders, deliberate monospace ticket chips, zero glassmorphism or AI purple-gradient halos.

## Evidence on Hand

- Complete database schema in `src/lib/database.types.ts` defining projects, project_members, project_invitations, issues, qa_verifications, qa_verification_attachments, issue_comments, activity_log, and notifications.
- Existing React frontend covering authentication, dashboard metrics, issue list, ticket detail, task assignment, member management, and settings.

## Product Principles

1. **Precision Over Decoration:** Data legibility, unambiguous bug reproduction, and execution speed outrank decorative visuals.
2. **First-Class Verification:** Testing is not merely a status column; it is a structured record with evidence, environment details, and explicit verification verdicts.
3. **High Information Density Without Clutter:** Backlogs, issue cards, and detail panels prioritize scannability with tight, structured hierarchy instead of endless nested containers.
4. **Instant Keyboard and Tabular Scanning:** Fast navigation, high-contrast states, and clear monospace anchors make finding and triaging tickets effortless.

## Accessibility & Inclusion

- Compliance with WCAG AA contrast standards across all surfaces.
- Legible typography scale (no functional text below 12px; avoid arbitrary micro-font classes).
- Accessible form controls with explicit labels, clear focus indicators (rings, not mere color shifts), and keyboard-navigable tables and modals.
