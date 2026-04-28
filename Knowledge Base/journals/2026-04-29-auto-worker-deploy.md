# 2026-04-29 - Automatic Worker Deploy

## Context

Manual deploys after pushing to `main` were easy to forget. The Worker is already
defined in `wrangler.toml`, so the repository can own the deploy path.

## Changes

- Added `.github/workflows/deploy-worker.yml`.
- The workflow runs on pushes to `main` and manual `workflow_dispatch`.
- The workflow installs dependencies, runs tests, runs build checks, then deploys
  with `npm run worker:deploy`.
- Documented the required GitHub secret: `CLOUDFLARE_API_TOKEN`.

## Operations Note

The Cloudflare API token value is not stored in the repository. It must be added
as a GitHub repository secret before the first automatic deployment can succeed.
