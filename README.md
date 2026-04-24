# alhikmahschoolstudentwellbeing

Interim student wellbeing and casework platform.

## Runtime

- Apps Script is the only staff-facing web app.
- Apps Script handles the UI shell and Google Workspace identity.
- Apps Script signs requests to a private Cloudflare Worker API.
- The Worker enforces permissions, filtering, visibility, redaction, audit logging, and Neon access.
- Neon PostgreSQL remains the system of record.

## Key IDs

- Apps Script project ID: `19EBgbNt3I_SEYaYEqr1NQEPtnvHlHH5QO3PsdgGlp2997nHoAmWgHOix`
- Apps Script deployment ID: `AKfycbyGFMjbRi3z06Sm2-GJaHiqtOG2xlyt8zmWuLeCrUprmhFJmsNNVjzD-tqIIv7f9c_bjA`

## Setup

```bash
npm install
npm run migrate
npm test
```

## Worker

Set Worker secrets:

```bash
npm run worker:secret:database
npm run worker:secret:bridge
```

Deploy:

```bash
npm run worker:deploy
```

Required Worker secrets:

- `DATABASE_URL`
- `WORKER_SHARED_SECRET`

## Apps Script

Required Apps Script script properties:

- `WORKER_API_URL`
- `WORKER_SHARED_SECRET`
- `WORKER_KEY_ID` optional

Deploy:

```bash
npm run apps:push
npm run apps:deploy
```

## Security Notes

- Do not put Neon credentials in Apps Script.
- Do not expose the Worker URL as a user-facing app route.
- SQL is parameterised and structured filters compile only through allowlisted fields.
- Worker-side permissions and team visibility are authoritative.
- Signed Apps Script requests use persistent nonce replay protection in Neon.
