# Architecture

## Runtime Shape

- Google Apps Script hosts the web UI through `HtmlService`
- Apps Script acts as a trusted middle tier for authenticated school users
- A Node/Express API provides application logic and database access
- Neon PostgreSQL is the system of record

## Security Boundary

- Browser never receives database credentials
- Browser never talks directly to Neon
- Apps Script signs backend requests with a shared HMAC secret and includes the active user identity asserted from Google Workspace context
- Backend maps asserted identity to an internal active user record before authorising anything

## Major Layers

- Apps Script UI shell, templates, and proxy functions
- Backend routes for domain APIs
- Backend services for auth, filtering, visibility, and audit logging
- SQL migrations and seed data

## Interim Rationale

Apps Script provides rapid secure internal deployment within a school Google Workspace environment. The Node/Neon layer preserves a migration path toward a fuller platform because data access, rules, and schema are kept outside Apps Script.
