# Handover

## What Changed

- Refactored runtime to Apps Script UI -> Cloudflare Worker API -> Neon PostgreSQL.
- Removed direct Neon access from Apps Script.
- Added signed Apps Script-to-Worker requests with timestamp, nonce, Workspace email, and HMAC signature.
- Added Worker route handling for students, profiles, notes, concerns, meetings, follow-ups, radar, settings, saved filters, audit logs, and structured filters.
- Added persistent signed-request nonce replay protection.
- Added automated Worker tests for permissions, redaction, structured filters, team visibility, and nonce replay.
- Tightened the UI with compact headers, denser student table, friendly filter builder, calendar/list view, and Jira-style profile action bar.
- Removed developer-facing wording from the staff UI and replaced large loading blocks with compact skeleton states.
- Added Builder/Advanced mode switching for student filters while preserving URL-driven structured filtering behind the scenes.
- Slimmed dashboard KPI cards and replaced dashboard filter examples with upcoming follow-ups for the signed-in user.
- Removed the standalone Concerns navigation item; concerns are logged from the student profile.
- Added migration `006_hybrid_beta_defaults.sql` for radar labels and caseworker student creation.
- Added migration `007_beta_hardening_nonce_calendar.sql` for nonce persistence, action visibility, and calendar indexes.
- **Migration `008_ofsted_readiness.sql`**: concern closure with mandatory outcome, referral tracking, SEND plan model, external agency fields on meetings, chronology enrichment, new permissions (concerns.close, send.manage, referrals.manage).

## Current Architecture

- Staff open the Apps Script web app URL.
- Apps Script resolves the signed-in Google Workspace email.
- Apps Script signs API requests and calls the private Worker `/api/proxy` endpoint.
- The Worker verifies the signed bridge request, enforces RBAC and team visibility, compiles filters, queries Neon, redacts responses, and writes audit logs.
- Neon remains the system of record.

## What Works

- Bootstrap, dashboard, compact student list, student creation, student profile, inline support actions, calendar/list meetings, settings, saved filters, and audit view are wired through the Worker API.
- Radar badges show active team involvement.
- Filters remain URL-driven and backend-compiled, with a friendly builder as the default staff experience.
- DSL safeguarding panel on dashboard (concerns.review permission-gated).
- Concern closure with mandatory outcome summary and escalation log.
- Referral tracking on safeguarding concerns (MASH, LADO, police, etc.).
- SEND plan panel on student profile with Assess→Plan→Do→Review fields.
- External agency fields on meeting log form (conditional display).
- Enriched timeline entries showing action taken, outcome, next steps, referral info.

## Remaining Incomplete

- Calendar remains beta-lightweight and is not a full scheduling engine.
- PostgreSQL RLS is not implemented yet; keep it as a later hardening option.
- `agency_contacts` table defined in schema design but not yet wired (log via meetings for now).
- `attendance_imports` table designed but not wired; attendance data must come from MIS (SIMS/Arbor) via a future import script.
- Backfill/import UI for spreadsheet data not yet built.
- Deployment note: Apps Script Execution API invocation was not permitted from `clasp`, so the current production deployment was aligned with the Worker secret at deploy time. Before the next clean redeploy, set Apps Script script properties or repeat the bridge-secret deployment alignment.

## Required Secrets

Apps Script script properties:

- `WORKER_API_URL`
- `WORKER_SHARED_SECRET`
- `WORKER_KEY_ID` optional

Worker secrets:

- `DATABASE_URL`
- `WORKER_SHARED_SECRET`

Local migration secret:

- `.env.local` with `DATABASE_URL`

## Deployment

1. Run `npm install`.
2. Run `npm run migrate`.
3. Run `npm test`.
4. Set Worker secrets with `npm run worker:secret:database` and `npm run worker:secret:bridge`.
5. Deploy Worker with `npm run worker:deploy`.
6. Set Apps Script script properties.
7. Push Apps Script with `npm run apps:push`.
8. Redeploy Apps Script with `npm run apps:deploy`.

## Test First

- Open Apps Script as an authorised staff user.
- Confirm bootstrap loads without exposing the Worker URL.
- Search students and apply `radar==safeguarding`.
- Toggle Students between Builder and Advanced filter modes.
- Confirm Dashboard, Calendar, and Settings load without large layout jumps.
- Create a student as a caseworker/admin.
- Open a profile and add a note, meeting, concern, follow-up, radar, and status change.
- Log a safeguarding concern and verify referral fields appear conditionally.
- Close a concern — verify outcome summary is required.
- Add a SEND plan and verify it appears in the sidebar panel.
- Log a meeting with an external agency and verify the fields appear.
- As a DSL (concerns.review role), verify the safeguarding panel appears on the dashboard.
- Verify a lower-privilege user sees redacted or hidden data, and does not see the DSL panel.
