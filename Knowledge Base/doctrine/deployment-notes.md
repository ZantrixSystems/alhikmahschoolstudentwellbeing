# Deployment Notes

## Environments

- Cloudflare Worker
- Neon PostgreSQL

## Secrets

- Cloudflare Worker secret for `DATABASE_URL`
- future auth secrets for Google OIDC or Cloudflare Access integration

## Deployment Expectations

- Worker deployed to the intended Cloudflare account and Worker name
- Neon accessed using TLS, preferably with `sslmode=verify-full`
- migrations applied before first production use
