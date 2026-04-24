# Architecture

## Runtime Shape

- Google Apps Script hosts the staff-facing web app.
- Cloudflare Worker hosts the private API layer.
- Neon PostgreSQL is the system of record.
- Local Node tooling is used for migrations and deployment commands.

## Request Flow

1. A staff user opens the Apps Script web app.
2. Apps Script resolves the signed-in Workspace email with `Session.getActiveUser()`.
3. Apps Script signs the API request with `API_SIGNING_SECRET`.
4. The Worker verifies the token, timestamp, HMAC signature, and signed email.
5. The Worker maps the email to the internal `users` table.
6. The Worker enforces role permissions, team visibility, and record-level rules before querying Neon.

## Security Boundary

- Browser code never receives database credentials.
- Apps Script never stores the Neon database password.
- Apps Script-to-Worker requests are signed server-side.
- Worker code owns all database access and permission enforcement.
- UI hiding is treated as convenience only; the Worker remains the security boundary for data access.

## Major Layers

- Apps Script HtmlService shell and client UI.
- Apps Script server functions that proxy signed API calls.
- Worker API services for auth, filtering, visibility, and audit logging.
- SQL migrations and seed data for Neon.

## Interim Rationale

This hybrid keeps the school-required Apps Script host while preserving a cleaner, safer Neon integration through the Worker. It avoids putting database credentials into Apps Script and keeps the future migration path open because the Worker API can later support a non-Apps-Script frontend.
