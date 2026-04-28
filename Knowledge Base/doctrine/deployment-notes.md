# Deployment Notes

## Environments

- Cloudflare Worker for the staff-facing UI and API.
- Neon PostgreSQL for persistence.

## Worker

Required Worker secret:

- `DATABASE_URL`

Required Worker variable:

- `GOOGLE_CLIENT_ID`

Commands:

```bash
npm run worker:secret:database
npm run worker:deploy
```

`npm run worker:deploy` builds `worker/index.built.js` by inlining `public/index.html`, then deploys that built Worker file.

## Deployment Order

1. Apply Neon migrations with `npm run migrate`.
2. Set or rotate the Worker `DATABASE_URL` secret.
3. Set `GOOGLE_CLIENT_ID` in `wrangler.toml`.
4. Run `npm test`.
5. Deploy Worker with `npm run worker:deploy`.

## Security Notes

- Keep Neon credentials Worker-only.
- The Google OAuth client ID is public configuration, not a secret.
- Treat changes to Google OAuth configuration, Worker auth verification, permissions, visibility, and redaction as security-relevant.
