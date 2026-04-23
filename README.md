# alhikmahschoolstudentwellbeing

This repository now runs as a single Cloudflare Worker application backed by Neon PostgreSQL.

## Runtime

- Cloudflare Worker serves the frontend and API routes
- Neon PostgreSQL is the system of record
- Local Node is only used for migrations

## Local Setup

Create `.env.local` from `.env.example`.

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=verify-full
```

Install dependencies:

```bash
npm install
```

Run migrations:

```bash
npm run migrate
```

Start local development:

```bash
npm run dev
```

## Cloudflare Deployment

This repo is configured for the existing Worker:

- Worker name: `wellbeing`
- Cloudflare account: `Ali.rahman@alhikmahschool.org`

Required Worker secret:

- `DATABASE_URL`

Set it with Wrangler:

```bash
wrangler secret put DATABASE_URL
```

Then deploy:

```bash
npm run deploy
```

## Product Notes

- Role-based access control and team visibility rules are enforced server-side in the Worker
- Structured filtering uses the same RSQL/FIQL-inspired grammar across list routes
- The current Worker deployment uses a bootstrap internal user for access while a fuller Google sign-in layer is being migrated in
