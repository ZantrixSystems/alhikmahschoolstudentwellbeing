# Beta Handover

## What Changed

- Refactored runtime to Apps Script UI -> Cloudflare Worker API -> Neon PostgreSQL.
- Removed direct Neon access from Apps Script.
- Added signed Apps Script-to-Worker requests with timestamp, nonce, Workspace email, and HMAC signature.
- Added Worker route handling for students, profiles, notes, concerns, meetings, follow-ups, radar, settings, saved filters, audit logs, and structured filters.
- Added persistent signed-request nonce replay protection.
- Added automated Worker tests for permissions, redaction, structured filters, team visibility, and nonce replay.
- Tightened the UI with compact headers, denser student table, friendly filter builder, calendar/list view, and Jira-style profile action bar.
- Removed the standalone Concerns navigation item; concerns are logged from the student profile.
- Added migration `006_hybrid_beta_defaults.sql` for radar labels and caseworker student creation.
- Added migration `007_beta_hardening_nonce_calendar.sql` for nonce persistence, action visibility, and calendar indexes.

## Current Architecture

- Staff open the Apps Script web app URL.
- Apps Script resolves the signed-in Google Workspace email.
- Apps Script signs API requests and calls the private Worker `/api/proxy` endpoint.
- The Worker verifies the signed bridge request, enforces RBAC and team visibility, compiles filters, queries Neon, redacts responses, and writes audit logs.
- Neon remains the system of record.

## What Works

- Bootstrap, dashboard, compact student list, student creation, student profile, inline casework actions, calendar/list meetings, settings, saved filters, and audit view are wired through the Worker API.
- Radar badges show active team involvement.
- Structured filters remain URL-driven and backend-compiled.

## Remaining Incomplete

- Calendar remains beta-lightweight and is not a full scheduling engine.
- PostgreSQL RLS is not implemented yet; keep it as a later hardening option.
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
- Create a student as a caseworker/admin.
- Open a profile and add a note, meeting, concern, follow-up, radar, and status change.
- Verify a lower-privilege user sees redacted or hidden data.
