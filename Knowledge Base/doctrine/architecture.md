# Architecture

## Runtime Shape

- Google Apps Script is the only staff-facing application surface.
- Apps Script owns the UI shell and Google Workspace identity resolution.
- Cloudflare Worker is the private API layer.
- Neon PostgreSQL is the system of record.
- Local Node tooling is used for migrations, `clasp`, and Worker deployment commands.

## Request Flow

1. Staff open the Apps Script web app URL.
2. Apps Script resolves the signed-in Workspace email with `Session.getActiveUser()`.
3. Apps Script signs the request body with `WORKER_SHARED_SECRET`.
4. Apps Script posts to the Worker `/api/proxy` endpoint.
5. The Worker verifies timestamp, nonce, Workspace email, and HMAC signature.
6. The Worker resolves the internal user, roles, teams, permissions, and domain rules.
7. The Worker compiles structured filters through allowlisted fields and operators.
8. The Worker sends parameterised SQL to Neon.
9. The Worker applies team visibility, redaction, response shaping, and audit logging before returning data to Apps Script.

## Security Boundary

- Browser code never receives the Worker URL directly.
- Browser code never receives Neon credentials.
- Neon credentials must not live in Apps Script.
- Apps Script is trusted for Google Workspace identity only.
- The Worker is authoritative for permissions, filtering, visibility, redaction, and audit logging.
- UI hiding is convenience only; all sensitive decisions must be enforced in the Worker.

## Major Layers

- Apps Script HtmlService shell and client UI.
- Apps Script signed proxy bridge.
- Cloudflare Worker route, service, filtering, permission, visibility, and audit logic.
- Neon schema, migrations, and seed data.

## Interim Rationale

The hybrid model keeps the required Apps Script staff entry point while moving sensitive backend decisions and Neon access into private infrastructure. It is still intentionally beta-sized, but the split creates a cleaner migration path toward a future MIS API.
