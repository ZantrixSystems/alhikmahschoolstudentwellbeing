# Deployment Notes

## Environments

- Google Apps Script web app for the staff-facing UI.
- Cloudflare Worker for the private API.
- Neon PostgreSQL for persistence.

## Apps Script

- Project ID: `19EBgbNt3I_SEYaYEqr1NQEPtnvHlHH5QO3PsdgGlp2997nHoAmWgHOix`
- Web app deployment ID: `AKfycbyGFMjbRi3z06Sm2-GJaHiqtOG2xlyt8zmWuLeCrUprmhFJmsNNVjzD-tqIIv7f9c_bjA`
- Access: domain restricted.
- Execute as: deploying user.

Required script properties:

- `WORKER_API_URL`
- `WORKER_SHARED_SECRET`
- `WORKER_KEY_ID` optional, defaults to `apps-script-main`

Apps Script must not store `NEON_DATABASE_URL`.

## Worker

Required Worker secrets:

- `DATABASE_URL`
- `WORKER_SHARED_SECRET`

Commands:

```bash
npm run worker:secret:database
npm run worker:secret:bridge
npm run worker:deploy
```

## Deployment Order

1. Apply Neon migrations with `npm run migrate`.
2. Set or rotate Worker secrets.
3. Deploy Worker with `npm run worker:deploy`.
4. Set Apps Script bridge properties.
5. Push Apps Script files with `npm run apps:push`.
6. Redeploy the Apps Script web app with `npm run apps:deploy`.

## Security Notes

- Keep Worker URL out of visible UI code and normal staff instructions.
- Keep Apps Script access domain restricted.
- Treat Worker secret rotation and Apps Script script property changes as security-relevant.
