# alhikmahschoolstudentwellbeing

This repo now uses a split architecture:

- Google Apps Script handles the UI/workflow.
- A small Node API handles database access.
- Neon/Postgres stores the data.

The database credentials stay out of Apps Script and out of Git. Apps Script only calls the API over HTTPS with an API token.

## 1. Local secrets

Create `.env.local` from `.env.example`.

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=verify-full
API_PORT=3000
APPS_SCRIPT_API_TOKEN=replace-with-a-long-random-secret
```

`DATABASE_URL` is how the backend authenticates to Neon. Prefer `sslmode=verify-full`.

## 2. Install dependencies

```bash
npm install
```

## 3. Run migrations

```bash
npm run migrate
```

This creates:

- `students`
- `wellbeing_entries`
- `schema_migrations`

## 4. Start the API

```bash
npm run dev
```

Health check:

```bash
curl http://localhost:3000/health
```

## 5. Configure Apps Script

Set these script properties in Apps Script:

- `API_BASE_URL`
- `API_TOKEN`

Example values:

- `API_BASE_URL=https://your-api-hostname`
- `API_TOKEN=` the same value as `APPS_SCRIPT_API_TOKEN` in the backend environment

Once set, Apps Script can use:

- `listStudents()`
- `createWellbeingEntry(studentId, score, notes)`

## Security notes

- `.claspignore` prevents backend files from being pushed to Apps Script.
- `.gitignore` prevents local secrets from being committed.
- Apps Script never sees the Neon database password.
- Neon traffic is encrypted with TLS through the connection string.
