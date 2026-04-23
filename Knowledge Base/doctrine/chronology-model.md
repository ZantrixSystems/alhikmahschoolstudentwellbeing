# Chronology Model

## Event Types

- concern_logged
- referral_received
- team_onboarded
- team_offboarded
- meeting_logged
- note_added
- risk_updated
- action_created
- action_completed
- external_agency_contact
- parent_contact
- review_held
- status_changed

## Design

- chronology is append-friendly and audit-oriented
- events can include both a protected detail payload and a safer summary payload
- edits to source records update source metadata but chronology entries remain historically meaningful

## Visibility

Chronology rendering is permission-aware and team-visibility-aware. Some users may see that something happened without seeing the protected narrative.
