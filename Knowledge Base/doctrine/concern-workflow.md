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
- safeguarding concerns are automatically confidentiality-gated at creation

## Concern Closure (migration 008)

Closing a concern is a distinct, permission-gated operation (`concerns.close`).
`outcome_summary` is mandatory on closure — the API rejects a close request without it.
`closed_by_user_id` and `closed_at` are recorded on the concern row.
Each status transition appends an entry to `concerns.escalation_log` (JSONB array),
preserving the full decision chain for inspection scrutiny.

## Referral Tracking (migration 008)

Safeguarding concerns support structured referral fields:
- `referral_type`: none / mash / lado / police / early_help / camhs / social_care / other
- `referral_date`: date the referral was made
- `referral_outcome`: agency response (free text)

Safeguarding concerns automatically receive `confidentiality_level = 'safeguarding'` at creation.

Referral specifics (`referral_outcome`, `referral_date`, `outcome_summary`, `closed_by_name`,
`external_ref`) are redacted at `summary` visibility and below. Only users with `full` visibility
see the complete referral narrative. This matches the need-to-know principle for
multi-agency safeguarding information.
