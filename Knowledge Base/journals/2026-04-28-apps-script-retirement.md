# 2026-04-28 Apps Script Retirement

## Migration Direction

- Apps Script is being retired as the staff-facing runtime.
- The browser now talks directly to the Cloudflare Worker.
- Staff authentication now uses Google ID tokens presented by the browser and verified by the Worker.
- Neon remains behind the Worker and must not be exposed to browser code.

## Security Boundary

- The Worker remains authoritative for internal user resolution, roles, teams, permissions, structured filtering, visibility, redaction, and audit logging.
- Google authentication remains separate from internal app authorisation.
- UI hiding remains ergonomic only; sensitive decisions continue to be enforced server-side.

## Migration Notes

- The Apps Script signed-proxy bridge has been removed from the active runtime path.
- Apps Script script properties for Worker bridge secrets are no longer required.
- Keep the direct browser-to-Worker API shaped around the existing Worker service boundary so the future MIS migration remains incremental.
