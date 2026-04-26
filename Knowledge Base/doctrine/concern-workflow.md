# Concern Workflow

## Flow

1. Staff member submits a concern
2. Concern is triaged by an authorised team
3. Concern may be escalated to active team radar
4. Actions, meetings, and notes may follow
5. Concern is resolved or closed with mandatory outcome summary

## Safeguarding-Conscious Behaviour

- confidential concerns can be marked for restricted visibility
- ownership and status are tracked
- chronology records submission, escalation, and resolution milestones
- concerns owned by the Safeguarding team are automatically confidentiality-gated at creation and update
- the concern category is retained only as a backend compatibility field and is derived from team ownership
- incident type and action taken values are settings-managed reference options validated by the Worker

## Concern Closure (migration 008)

Closing a concern is a distinct, permission-gated operation (`concerns.close`).
`outcome_summary` is mandatory on closure — the API rejects a close request without it.
`closed_by_user_id` and `closed_at` are recorded on the concern row.
Each status transition appends an entry to `concerns.escalation_log` (JSONB array),
preserving the full decision chain for inspection scrutiny.

## Referral Tracking (migration 008)

Concerns owned by the Safeguarding team support structured referral fields:
- `referral_type`: none / mash / lado / police / early_help / camhs / social_care / other
- `referral_date`: date the referral was made
- `referral_outcome`: agency response (free text)

Safeguarding team concerns automatically receive `confidentiality_level = 'safeguarding'`
at creation and update. The staff UI does not expose a category dropdown; selecting the
Safeguarding team reveals referral fields and the Worker derives backend category and
confidentiality from `teams.team_key = 'safeguarding'`.

Referral specifics (`referral_outcome`, `referral_date`, `outcome_summary`, `closed_by_name`,
`external_ref`) are redacted at `summary` visibility and below. Only users with `full` visibility
see the complete referral narrative. This matches the need-to-know principle for
multi-agency safeguarding information.

## Behaviour and Action Fields (migration 012)

Concern records retain `incident_type` and gain `action_taken`.
Both fields are validated server-side against active `reference_options` rows for
`concerns.incident_type` and `concerns.action_taken`.

The previous sanction model is retired. Migration 012 drops sanction columns, and the
Worker no longer accepts or validates sanction-specific API fields.
