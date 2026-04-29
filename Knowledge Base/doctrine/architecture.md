# Architecture

## Runtime Shape

- Cloudflare Worker is the staff-facing application surface and API host.
- The Worker serves the standalone SPA from `/` and browser deep links such as
  `/students/:studentId`, `/meetings`, and `/settings/:tab`.
- Browser code authenticates with Google Identity Services and calls `/api/*` routes directly.
- Neon PostgreSQL is the system of record and is reachable only from the Worker.
- Local Node tooling is used for migrations, Worker build, tests, and deployment.

## Request Flow

1. Staff open the Cloudflare Worker URL.
2. The browser obtains a Google ID token from Google Identity Services.
3. Browser API calls send `Authorization: Bearer <id-token>` to direct Worker routes.
4. The Worker verifies issuer, expiry, audience, and signature for the Google ID token.
5. The Worker resolves the internal user, roles, teams, permissions, and domain rules.
6. The Worker compiles structured filters through allowlisted fields and operators.
7. The Worker sends parameterised SQL to Neon.
8. The Worker applies team visibility, redaction, response shaping, and audit logging before returning data to the browser.

## Security Boundary

- Browser code never receives Neon credentials.
- The Google OAuth client ID may be public; it is not a secret.
- The Worker is authoritative for permissions, filtering, visibility, redaction, and audit logging.
- UI hiding is convenience only; all sensitive decisions must be enforced in the Worker.
- Google authentication only proves identity. Internal app authorisation still depends on active user records, roles, teams, and permissions.

## Major Layers

- Worker-served standalone SPA.
- Cloudflare Worker route, service, filtering, permission, visibility, and audit logic.
- Neon schema, migrations, and seed data.

## Browser Routing

The SPA uses path-based History API routes for operational screens:

- `/` for the dashboard
- `/students` for the student directory
- `/students/:studentId` for a student profile
- `/meetings` for meetings and follow-ups
- `/settings/:tab` for settings sections

List filters, search terms, filter mode, and meeting view mode remain query parameters so
list state can be linked, refreshed, and restored with browser back/forward navigation.
The Worker must continue serving the app shell for non-API `GET` paths while preserving
`/api/*` as authenticated JSON routes and `/health` as the unauthenticated health check.

## 2026-04-28 Migration Note

Apps Script has been retired from the runtime. The previous proxy model is replaced by direct browser-to-Worker requests authenticated with Google ID tokens. The intended migration path is to keep business rules in the Worker while a future MIS-grade frontend or identity integration can be introduced incrementally.
