# Beta Handover

## What Changed

- Refactored runtime to Apps Script UI -> Cloudflare Worker API -> Neon PostgreSQL.
- Removed direct Neon access from Apps Script.
- Added signed Apps Script-to-Worker requests with timestamp, nonce, Workspace email, and HMAC signature.
- Added Worker route handling for students, profiles, notes, concerns, meetings, follow-ups, radar, settings, saved filters, audit logs, and structured filters.
- Tightened the UI with compact headers, denser student table, friendly filter builder, calendar/list view, and Jira-style profile action bar.
- Removed the standalone Concerns navigation item; concerns are logged from the student profile.
- Added migration `006_hybrid_beta_defaults.sql` for radar labels and caseworker student creation.

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

- Worker nonce replay protection is timestamp-only.
- Calendar is a lightweight grouped view, not a full scheduling engine.
- Automated regression tests are still needed around permissions, redaction, and filter parsing.
- Follow-up records currently use the `actions` table and appear mainly through profile/timeline and dashboard counts.
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
3. Set Worker secrets with `npm run worker:secret:database` and `npm run worker:secret:bridge`.
4. Deploy Worker with `npm run worker:deploy`.
5. Set Apps Script script properties.
6. Push Apps Script with `npm run apps:push`.
7. Redeploy Apps Script with `npm run apps:deploy`.

## Test First

- Open Apps Script as an authorised staff user.
- Confirm bootstrap loads without exposing the Worker URL.
- Search students and apply `radar==safeguarding`.
- Create a student as a caseworker/admin.
- Open a profile and add a note, meeting, concern, follow-up, radar, and status change.
- Verify a lower-privilege user sees redacted or hidden data.
