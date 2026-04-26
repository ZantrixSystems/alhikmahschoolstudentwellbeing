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
- reference_options   (migration 012)
- audit_logs
- send_plans          (migration 008)
- agency_contacts     (planned — not yet implemented)
- attendance_imports  (planned — not yet implemented)

## Design Traits

- UUID primary keys
- soft delete for mutable business records
- `created_at`, `updated_at`, `created_by`, `updated_by`
- event tables carry visibility metadata and redacted summary fields
- JSONB used only where flexibility is helpful, not as the primary model

## Migration Direction

The schema uses explicit relational tables so future MIS integration can reuse student and casework entities cleanly.

Neon remains the system of record. Apps Script must not connect to Neon directly; all reads and writes go through the Worker API.

## SEND Model (migration 008)

`students.send_category` replaces the boolean `send_status` flag:
  none | sen_support | ehcp | assessed_no_need

`send_plans` holds the Assess → Plan → Do → Review cycle record:
  - plan_type, plan_ref, identified_needs, planned_provision
  - review_date, review_outcome, ehcp_annual_review_date
  - external_agency, specialist_name, status

At most one plan is `active` or `under_review` per student at a time.
Creating a new plan via POST /api/send-plans closes any existing active plan.

## External Agency Evidence (migration 008)

`meetings.external_agency`, `meetings.external_contact_name`, `meetings.external_ref`
support recording contacts with MASH, CAMHS, social care, etc. as structured meeting records.
The chronology event type is `external_agency_contact` when an agency is specified.

## Chronology Enrichment (migration 008)

`chronology_events` gains: `action_taken`, `outcome`, `next_step`,
`next_step_owner_id`, `next_step_due` — supporting full Ofsted-style evidence narratives.

## Managed Concern Reference Options (migration 012)

`reference_options` stores settings-managed dropdown values for constrained operational fields.
The initial managed concern fields are:

- `concerns.incident_type`
- `concerns.action_taken`

The Worker validates submitted concern incident/action values against active rows in
`reference_options`; these values are no longer hard-coded in the API. Migration 012
also removes obsolete sanction columns from `concerns`.
