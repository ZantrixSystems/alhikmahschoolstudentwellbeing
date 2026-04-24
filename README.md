# alhikmahschoolstudentwellbeing

This repository now runs as a Google Apps Script web app backed directly by Neon PostgreSQL.

## Runtime

- Google Apps Script hosts the staff-facing web app.
- Apps Script server functions enforce authentication, RBAC, team visibility, filtering, and audit logging.
- Apps Script calls Neon's HTTPS SQL endpoint with parameterised queries.
- Neon PostgreSQL remains the system of record.
- Local Node is used only for migrations and Apps Script deployment tooling.

## Key IDs

- Apps Script project ID: `19EBgbNt3I_SEYaYEqr1NQEPtnvHlHH5QO3PsdgGlp2997nHoAmWgHOix`
- Apps Script deployment ID: `AKfycbyGFMjbRi3z06Sm2-GJaHiqtOG2xlyt8zmWuLeCrUprmhFJmsNNVjzD-tqIIv7f9c_bjA`

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

## Secrets

Apps Script script properties:

- `NEON_DATABASE_URL`

Local development secrets:

- `.env.local` contains `DATABASE_URL` for migrations.

## Security Notes

- Client-side code never receives database credentials.
- Apps Script server functions are the data access boundary.
- SQL is parameterised; structured filters compile only through allowlisted fields and operators.
- Role permissions and team visibility are enforced server-side.
- `.claspignore` keeps migrations, docs, dependencies, and local secrets out of the Apps Script project.
