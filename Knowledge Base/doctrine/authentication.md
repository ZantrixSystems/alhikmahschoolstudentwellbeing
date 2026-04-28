# Authentication

## Current Approach

- Staff authenticate in the browser through Google Identity Services.
- The browser receives a Google ID token for the configured `GOOGLE_CLIENT_ID`.
- Every API call sends the token in `Authorization: Bearer <id-token>`.
- The Worker verifies the token before resolving the internal user record.

## Google ID Token Verification

The Worker verifies:

- token format
- expiry
- issuer
- audience matching `GOOGLE_CLIENT_ID`
- signature using Google's published JWKs
- presence of an email claim

The email claim is then lowercased and used to resolve the internal user.

## Domain Restriction

- Allowed Workspace domains are stored in `app_settings`.
- Domain checks happen in the Worker after Google token verification.
- Domain allowlisting is separate from internal app authorisation.

## App Authorisation

- A user must exist in `users`.
- The user must be active.
- The user must have an effective permission for the requested action.
- Newly created users have no roles or teams unless explicitly assigned, so their default access is none.
- Deleted users are soft-deleted, deactivated, removed from roles and teams, and no longer resolve during authentication.
- The built-in `admin` role remains fixed and full access.

## Future Hardening

- Cache Google's JWKs with expiry-aware refresh if request volume grows.
- Add device, network, and anomaly signals for a full MIS platform.
- Consider database-enforced RLS as an additional layer after the Worker policies are stable.
