# 2026-04-26 - Concern Reference Options

## Work Session

- Added a migration-friendly `reference_options` table for settings-managed dropdown values.
- Seeded default concern `incident_type` and `action_taken` options.
- Added `concerns.action_taken` and removed obsolete sanction columns in migration 012.
- Updated the Worker so concern incident/action validation is server-side and database-backed.
- Added permission-gated settings endpoints for reference option upsert/delete, with audit logging.

## Notes

The Apps Script frontend was not changed in this slice. Until the UI is updated, any legacy
sanction payload fields are not mapped or validated by the Worker and will not be persisted.
