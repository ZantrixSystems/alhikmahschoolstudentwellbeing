# Beta Handover

## What Works

- Single Cloudflare Worker architecture replacing Apps Script and the separate Express API
- Worker serves both static frontend assets and `/api/*` routes
- Neon remains the system of record with the existing wellbeing schema and migrations
- Student directory, profile, concerns, meetings, settings, and audit views are preserved in the new frontend
- Role, permission, team visibility, and structured filtering logic are enforced in Worker code

## What Was Removed

- Apps Script runtime files
- Apps Script deployment config
- Express API routes and middleware
- temporary local Neon/App Script bridge files

## Current Assumptions

- Deployment target is the existing Cloudflare Worker `wellbeing`
- Cloudflare account is `ali.rahman@alhikmahschool.org`
- Worker secret `DATABASE_URL` will be set in Cloudflare
- Current login path uses a bootstrap Worker email for controlled internal access until fuller Google auth is added to the Worker

## Incomplete Or Next

- Replace bootstrap auth with Google OIDC or Cloudflare Access-backed identity
- Expand actions, notes, reports, and exports into dedicated screens
- Add automated tests and a cleaner local seed/bootstrap workflow
