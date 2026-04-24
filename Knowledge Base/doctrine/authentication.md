# Authentication

## Current Approach

- Staff authenticate by opening the Google Apps Script web app inside the school Workspace context.
- Apps Script reads the active user email with `Session.getActiveUser()`.
- Apps Script signs every Worker request with:
  - key id
  - timestamp
  - nonce
  - asserted Workspace email
  - HMAC SHA-256 signature
- The Worker verifies the signature before resolving the internal user record.

## Signed Request Model

The canonical string is:

```text
timestamp
nonce
workspace-email
json-body
```

The Apps Script property `WORKER_SHARED_SECRET` and Worker secret `WORKER_SHARED_SECRET` must match. Requests older than five minutes are rejected.

## Nonce Replay Protection

After signature verification, the Worker hashes the nonce and inserts it into `signed_request_nonces` with the bridge key id and an expiry timestamp. The `(key_id, nonce_hash)` primary key makes replay attempts fail atomically. Expired nonces are deleted opportunistically during signed request verification.

## Domain Restriction

- Allowed Workspace domains are stored in `app_settings`.
- Domain checks happen in the Worker.
- Domain allowlisting is separate from internal app authorisation.

## App Authorisation

- A user must exist in `users`.
- The user must be active.
- The user must have an effective permission for the requested action.
- The built-in `admin` role remains fixed and full access.

## Future Hardening

- Replace opportunistic nonce cleanup with scheduled cleanup if request volume grows.
- Add Google ID token verification if Apps Script identity becomes insufficient.
- Add device, network, and anomaly signals for a full MIS platform.
