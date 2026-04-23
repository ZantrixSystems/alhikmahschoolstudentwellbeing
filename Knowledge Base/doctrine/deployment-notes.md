# Deployment Notes

## Environments

- Apps Script web app
- Node API host
- Neon PostgreSQL

## Secrets

- Apps Script script properties for API base URL, API token, signing secret, and domain settings cache if needed
- Backend environment variables for Neon connection and request verification

## Deployment Expectations

- Apps Script deployed to the intended Google Workspace audience
- Backend hosted behind HTTPS
- Neon accessed using TLS, preferably with `sslmode=verify-full`
- migrations applied before first production use
