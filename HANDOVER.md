# Beta Handover

## What Works

- Apps Script is restored as the school-facing web app host.
- The existing Apps Script project and deployment ID are in use.
- Apps Script script properties have been set for the Worker API bridge.
- The Cloudflare Worker remains as the private Neon API layer.
- Neon remains the system of record with the existing wellbeing schema and migrations.
- Student directory, profile, concerns, meetings, settings, audit, RBAC, team visibility, and structured filtering are preserved.

## Current Architecture

- Staff open the Apps Script web app.
- Apps Script obtains the signed-in Workspace email.
- Apps Script signs API requests and calls the Worker.
- The Worker verifies the request, loads the internal app user, and applies server-side permissions before querying Neon.

## Current Assumptions

- School-facing deployment remains Google Apps Script.
- The Worker URL is treated as an internal API endpoint rather than the user-facing app URL.
- The authorised admin user is `ali.rahman@alhikmahschool.org`.
- Apps Script web app access is restricted to the school domain.

## Incomplete Or Next

- Add automated regression tests around Worker API permissions and filtering.
- Replace the temporary Worker bootstrap fallback with a stricter signed-request-only mode once all access paths are confirmed.
- Continue polishing the Apps Script UI now that the deployment path is stable.
