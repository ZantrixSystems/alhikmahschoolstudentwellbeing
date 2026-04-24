# Deployment Notes

## Environments

- Google Apps Script web app for the staff-facing UI and backend functions.
- Neon PostgreSQL for persistence.

## Apps Script

- Project ID: `19EBgbNt3I_SEYaYEqr1NQEPtnvHlHH5QO3PsdgGlp2997nHoAmWgHOix`
- Web app deployment ID: `AKfycbyGFMjbRi3z06Sm2-GJaHiqtOG2xlyt8zmWuLeCrUprmhFJmsNNVjzD-tqIIv7f9c_bjA`
- Access: domain restricted.
- Execute as: deploying user.

Required script property:

- `NEON_DATABASE_URL`

## Deployment Order

1. Apply Neon migrations.
2. Push Apps Script files with `clasp`.
3. Redeploy the existing Apps Script web app deployment.

## Security Notes

- Keep `NEON_DATABASE_URL` out of Git.
- Prefer a reduced-privilege Neon role for the Apps Script runtime.
- Keep Apps Script access domain restricted.
- Audit script property changes as security-relevant changes.
