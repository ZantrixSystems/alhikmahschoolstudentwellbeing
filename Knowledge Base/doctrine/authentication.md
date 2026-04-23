# Authentication

## Current Approach

- App is intended for deployment as an Apps Script web app in Google Workspace
- Apps Script reads the active user email from the Google-hosted session
- Requests to the backend include:
  - API token
  - HMAC signature
  - request timestamp
  - asserted user email
- Backend validates signature and then resolves the internal user record

## Domain Restriction

- Allowed Google Workspace domains are stored in app settings
- Domain checks happen server-side
- Domain allowlisting is separate from app authorisation

## App Authorisation

- A user must exist in the internal `users` table
- User must be active
- User must have at least one applicable role for the requested action

## Future Hardening

- GIS token verification service
- SSO policy enforcement
- device and network context checks
- stronger session rotation and anomaly detection
