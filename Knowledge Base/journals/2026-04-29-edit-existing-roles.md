# 2026-04-29 Edit Existing Roles

## Context

Settings displayed the seeded Admin, Caseworker, and Concern Logger roles, but only exposed a
custom-role create form. The operational roles needed to be editable without weakening the
fixed admin role boundary.

## Changes

- Added role permission assignments to the settings reference payload.
- Updated Settings > Roles to show existing permissions and provide an Edit action for
  non-admin roles.
- Added update-by-role-ID support for role name, description, and permissions.
- Kept the built-in `admin` role immutable by role key and role ID.
- Marked seeded operational roles as editable for future installs and added a migration for
  existing databases.
- Added tests covering role permission payloads, non-admin role updates, and admin mutation
  protection.

## Notes

Role permission changes remain server-authoritative in the Worker. UI locking is only a
convenience; the Worker still denies admin role mutation directly.
