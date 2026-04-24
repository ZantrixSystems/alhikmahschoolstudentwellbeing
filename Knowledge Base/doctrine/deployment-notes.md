# Deployment Notes

## Environments

- Google Apps Script web app for the staff-facing UI.
- Cloudflare Worker for the private API layer.
- Neon PostgreSQL for persistence.

## Apps Script

- Project ID: `19EBgbNt3I_SEYaYEqr1NQEPtnvHlHH5QO3PsdgGlp2997nHoAmWgHOix`
- Web app deployment ID: `AKfycbyGFMjbRi3z06Sm2-GJaHiqtOG2xlyt8zmWuLeCrUprmhFJmsNNVjzD-tqIIv7f9c_bjA`
- Access: domain restricted.
- Execute as: deploying user.

Required script properties:

- `API_BASE_URL`
- `API_TOKEN`
- `API_SIGNING_SECRET`

## Worker

- Worker name: `wellbeing`
- Account: `Ali.rahman@alhikmahschool.org`

Required Worker secrets:

- `DATABASE_URL`
- `APPS_SCRIPT_API_TOKEN`
- `APPS_SCRIPT_SIGNING_SECRET`

## Deployment Order

1. Apply Neon migrations.
2. Deploy the Worker API.
3. Push Apps Script files with `clasp`.
4. Redeploy the existing Apps Script web app deployment.

## Security Notes

- Do not put Neon credentials into Apps Script.
- Keep Apps Script-to-Worker calls signed.
- Keep Apps Script access domain restricted.
- Audit changes to script properties and Worker secrets as security-relevant changes.
