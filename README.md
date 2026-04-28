# alhikmahschoolstudentwellbeing

Interim student wellbeing and casework platform.

## Runtime

- Cloudflare Worker is the staff-facing web app and API.
- The browser signs in with Google Identity Services and sends a Google ID token to the Worker.
- The Worker verifies Google identity, then resolves internal users, roles, teams, permissions, visibility, redaction, audit logging, and Neon access.
- Neon PostgreSQL remains the system of record.
- Apps Script is no longer part of the runtime or deployment path.

## UI Standard

- The staff UI should stay compact, stable, and product-focused.
- Avoid backend or deployment language in visible app copy.
- Use skeleton loading inside data panels so page headers and filters do not jump while data loads.

## Setup

```bash
npm install
npm run migrate
npm test
```

## Worker

Set the Neon secret:

```bash
npm run worker:secret:database
```

Configure `GOOGLE_CLIENT_ID` in `wrangler.toml`, then deploy:

```bash
npm run worker:deploy
```

Required Worker configuration:

- `DATABASE_URL` as a Worker secret.
- `GOOGLE_CLIENT_ID` as a Worker variable.

## Security Notes

- Do not expose Neon credentials outside the Worker.
- SQL is parameterised and structured filters compile only through allowlisted fields.
- Worker-side permissions and team visibility are authoritative.
- Google authentication is separate from internal authorisation; an authenticated Google account still needs an active internal user record and permissions.
