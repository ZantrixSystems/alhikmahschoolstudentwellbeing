# Beta Handover

## What Works

- Apps Script is the school-facing web app host.
- The existing Apps Script project and deployment ID are in use.
- Apps Script talks directly to Neon through the Neon HTTPS SQL endpoint.
- Neon remains the system of record with the existing wellbeing schema and migrations.
- Student directory, profile, concerns, meetings, settings, audit, RBAC, team visibility, and structured filtering are preserved.
- The Worker runtime has been removed from the app path and can be deleted.

## Current Architecture

- Staff open the Apps Script web app.
- Apps Script resolves the signed-in Workspace email.
- Apps Script maps the email to the internal `users` table.
- Apps Script enforces role permissions, team visibility, and record-level redaction.
- Apps Script sends parameterised SQL to Neon over HTTPS.

## Current Assumptions

- School-facing deployment remains Google Apps Script.
- The authorised admin user is `ali.rahman@alhikmahschool.org`.
- Apps Script web app access is restricted to the school domain.
- `NEON_DATABASE_URL` is set in Apps Script script properties.

## Incomplete Or Next

- Add automated regression tests around permissions and structured filtering.
- Consider a reduced-privilege Neon role for Apps Script runtime access.
- Continue polishing the Apps Script UI now that the deployment path is stable.
