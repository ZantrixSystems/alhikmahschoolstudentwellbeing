# Architecture

## Runtime Shape

- Google Apps Script hosts the staff-facing web app.
- Apps Script server functions act as the backend.
- Neon PostgreSQL is the system of record.
- Local Node tooling is used for migrations and deployment commands.

## Request Flow

1. A staff user opens the Apps Script web app.
2. Apps Script resolves the signed-in Workspace email with `Session.getActiveUser()`.
3. Apps Script maps the email to the internal `users` table.
4. Apps Script checks active status, roles, permissions, team memberships, and domain settings.
5. Apps Script compiles structured filters through allowlisted fields and operators.
6. Apps Script sends parameterised SQL to Neon over HTTPS.
7. Apps Script redacts records according to permissions and team visibility before returning data to the browser.

## Security Boundary

- Browser code never receives database credentials.
- Browser code never talks directly to Neon.
- Apps Script server functions are the security boundary for data access.
- UI hiding is treated as convenience only; server-side checks remain authoritative.
- Neon credentials live in Apps Script script properties and must be managed as production secrets.

## Major Layers

- Apps Script HtmlService shell and client UI.
- Apps Script server functions for auth, filtering, visibility, audit logging, and data access.
- SQL migrations and seed data for Neon.

## Interim Rationale

This keeps the school-required Apps Script host while avoiding a separate Worker runtime. The code remains migration-friendly because the data model, filter grammar, and permission boundaries are documented and can later move behind a fuller MIS API if needed.
