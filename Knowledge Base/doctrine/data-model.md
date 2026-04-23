# Data Model

## Core Entities

- users
- roles
- permissions
- role_permissions
- user_roles
- teams
- team_visibility_rules
- students
- student_flags
- student_team_radar
- concerns
- meetings
- notes
- actions
- chronology_events
- saved_filters
- app_settings
- audit_logs

## Design Traits

- UUID primary keys
- soft delete for mutable business records
- `created_at`, `updated_at`, `created_by`, `updated_by`
- event tables carry visibility metadata and redacted summary fields
- JSONB used only where flexibility is helpful, not as the primary model

## Migration Direction

The schema uses explicit relational tables so future MIS integration can reuse student and casework entities cleanly.
