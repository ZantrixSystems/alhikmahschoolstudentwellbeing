# alhikmahschoolstudentwellbeing

This repository is back to an Apps Script hosted app with a private Worker API layer backed by Neon PostgreSQL.

## Runtime

- Google Apps Script hosts the user-facing web app.
- Cloudflare Worker handles `/api/*` requests and talks to Neon.
- Neon PostgreSQL remains the system of record.
- Local Node is used for migrations and deployment tooling.

This keeps staff on the school-controlled Apps Script URL while keeping Neon credentials out of Apps Script.

## Key IDs

- Apps Script project ID: `19EBgbNt3I_SEYaYEqr1NQEPtnvHlHH5QO3PsdgGlp2997nHoAmWgHOix`
- Apps Script deployment ID: `AKfycbyGFMjbRi3z06Sm2-GJaHiqtOG2xlyt8zmWuLeCrUprmhFJmsNNVjzD-tqIIv7f9c_bjA`
- Worker name: `wellbeing`

## Setup

Install dependencies:

```bash
npm install
```

Run migrations:

```bash
npm run migrate
```

Push Apps Script files:

```bash
npm run apps:push
```

Redeploy the Apps Script web app:

```bash
npm run apps:deploy
```

Deploy the Worker API:

```bash
npm run worker:deploy
```

## Secrets

Apps Script script properties:

- `API_BASE_URL`
- `API_TOKEN`
- `API_SIGNING_SECRET`

Worker secrets:

- `DATABASE_URL`
- `APPS_SCRIPT_API_TOKEN`
- `APPS_SCRIPT_SIGNING_SECRET`

`API_TOKEN` must match `APPS_SCRIPT_API_TOKEN`. `API_SIGNING_SECRET` must match `APPS_SCRIPT_SIGNING_SECRET`.

## Security Notes

- Apps Script never stores the Neon database password.
- Apps Script signs API requests with HMAC before calling the Worker.
- The Worker resolves the signed Workspace email to the internal user record and enforces RBAC and team visibility server-side.
- `.claspignore` keeps Worker code, migrations, docs, local secrets, and dependencies out of the Apps Script project.
