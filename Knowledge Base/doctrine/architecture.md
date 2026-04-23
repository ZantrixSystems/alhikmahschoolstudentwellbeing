# Architecture

## Runtime Shape

- Cloudflare Worker hosts both the frontend and the API
- Static assets are served by the Worker deployment
- Worker code handles authentication, authorisation, filtering, visibility, and audit-aware data access
- Neon PostgreSQL is the system of record

## Security Boundary

- Browser never receives database credentials
- Browser never talks directly to Neon
- Worker talks to Neon over HTTPS using a server-side secret
- Internal user resolution and permissions happen server-side in Worker logic before protected data is returned

## Major Layers

- Worker fetch handler
- Worker API services for auth, filtering, visibility, and audit logging
- Static frontend assets
- SQL migrations and seed data

## Interim Rationale

Cloudflare Worker provides a cleaner single-runtime deployment model than Apps Script while still preserving the schema, visibility model, and migration path toward a fuller MIS platform.
