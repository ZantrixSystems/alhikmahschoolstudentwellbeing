# Handover

## What Changed

- Retired Apps Script from the runtime and deployment path.
- Added a standalone Worker-served SPA at `public/index.html`.
- Added Google Identity Services sign-in in the browser.
- Changed the browser API client to call Worker routes directly with `Authorization: Bearer <Google ID token>`.
- Changed the Worker HTTP boundary to serve `/`, handle CORS, and dispatch real `/api/*` routes.
- Kept Neon PostgreSQL behind the Worker only.
- Kept Worker-side RBAC, team visibility, redaction, structured filters, and audit logging as the authoritative security boundary.

## Current Architecture

- Staff open the Cloudflare Worker URL.
- The browser obtains a Google ID token using the configured Google OAuth client ID.
- The browser calls direct Worker API routes such as `GET /api/bootstrap` and `POST /api/concerns`.
- The Worker verifies the Google ID token, resolves the internal user, enforces permissions and team visibility, queries Neon, redacts responses, and writes audit logs.
- Neon remains the system of record.

## What Works

- Bootstrap, dashboard, compact student list, student creation, student profile, inline support actions, calendar/list meetings, settings, saved filters, and audit view are wired through the Worker API.
- Radar badges show active team involvement.
- Filters remain backend-compiled through the structured RSQL/FIQL-inspired model.
- DSL safeguarding panel remains permission-gated.
- Concern closure, referral tracking, SEND plans, external agency meeting fields, and enriched timeline entries remain in the Worker-backed flow.

## Remaining Incomplete

- Calendar remains beta-lightweight and is not a full scheduling engine.
- PostgreSQL RLS is not implemented yet; keep it as a later hardening option.
- `agency_contacts` table is defined in schema design but not yet wired.
- `attendance_imports` table is designed but not wired; attendance data must come from MIS via a future import script.
- Backfill/import UI for spreadsheet data is not yet built.
- Google OAuth client ID must be filled into `wrangler.toml` before deployment.

## Required Configuration

Worker secret:

- `DATABASE_URL`

Worker variable:

- `GOOGLE_CLIENT_ID`

Local migration secret:

- `.env.local` with `DATABASE_URL`

## Deployment

1. Run `npm install`.
2. Run `npm run migrate`.
3. Run `npm test`.
4. Set Worker database secret with `npm run worker:secret:database`.
5. Set `GOOGLE_CLIENT_ID` in `wrangler.toml`.
6. Deploy Worker with `npm run worker:deploy`.

## Test First

- Open the Worker URL as an authorised staff user.
- Confirm Google sign-in appears and bootstrap loads.
- Search students and apply `radar==safeguarding`.
- Toggle Students between Builder and Advanced filter modes.
- Confirm Dashboard, Calendar, and Settings load without large layout jumps.
- Create a student as a caseworker/admin.
- Open a profile and add a note, meeting, concern, follow-up, radar, and status change.
- Log a safeguarding concern and verify referral fields appear conditionally.
- Close a concern and verify outcome summary is required.
- Add a SEND plan and verify it appears in the sidebar panel.
- Log a meeting with an external agency and verify the fields appear.
- As a DSL, verify the safeguarding panel appears on the dashboard.
- Verify a lower-privilege user sees redacted or hidden data and does not see the DSL panel.
