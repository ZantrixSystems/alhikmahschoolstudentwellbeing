# 2026-04-25 — Ofsted Readiness Implementation (migration 008)

## Session goal

Close the critical Ofsted inspection gaps identified in the Phase 1–4 gap analysis.
Implement without redesigning the system: all additions are additive, compact, and conditional.

## What was built

### Migration 008 (`008_ofsted_readiness.sql`)
- `concerns`: added `referral_type`, `referral_date`, `referral_outcome`, `escalation_log` (JSONB), `closed_by_user_id`, `closed_at`, ensured `outcome_summary` present.
- `students`: added `send_category` (none / sen_support / ehcp / assessed_no_need); migrated `send_status = true` → `sen_support`.
- `meetings`: added `external_agency`, `external_contact_name`, `external_ref`.
- `chronology_events`: added `action_taken`, `outcome`, `next_step`, `next_step_owner_id`, `next_step_due`.
- New table: `send_plans` (SEND Assess→Plan→Do→Review cycle).
- New permissions: `concerns.close`, `send.manage`, `referrals.manage`.
- Granted new permissions to `caseworker` role.

### Worker (`worker/index.js`)
- `createConcern`: validates `referral_type` enum; forces `confidentiality_level = 'safeguarding'` for safeguarding category.
- `closeConcern`: new route `POST /api/concerns/:id/close`; requires `outcomeSummary`; rejects if already closed; appends to `escalation_log`.
- `createSendPlan`: new route `POST /api/send-plans`; closes existing active plan; updates `send_category` on student.
- `createMeeting`: accepts `externalAgency`, `externalContactName`, `externalRef`; sets event type to `external_agency_contact` when agency present.
- `getDashboardPayload`: fetches `openSafeguardingConcerns` only for `concerns.review` holders.
- `getStudentProfilePayload`: fetches `activeSendPlan`, enriched concern fields, enriched meeting fields, enriched chronology.
- `addChronology`: accepts `actionTaken`, `outcome`, `nextStep`, `nextStepDue`.
- `redactRecord`: strips referral/outcome/closure fields at summary visibility.
- Constants exported: `VALID_REFERRAL_TYPES`, `VALID_SEND_CATEGORIES`.

### Client (`Client.html`)
- Meeting form: external agency dropdown + contact/ref fields, shown conditionally on `external_agency` type.
- Concern form: referral type, date, outcome fields, shown conditionally on `safeguarding` category.
- Profile action bar: added `Close concern` (concerns.close) and `SEND plan` (send.manage).
- `closeconcern` form: select from open concerns, require outcome summary.
- `sendplan` form: plan type, status, ref, review dates, needs, provision, external agency, specialist.
- Student sidebar: `send_category` label replaces boolean SEND flag.
- SEND plan panel in sidebar when `activeSendPlan` is present.
- Timeline: renders `action_taken`, `outcome`, `outcome_summary`, `referral_type`/`referral_date`, `external_agency`, `next_step`/`next_step_due`/`next_step_owner_name`, `closed_at`/`closed_by_name`.
- Dashboard: DSL safeguarding panel (concerns.review gated), sorted by severity then updated_at.
- `sendCategoryLabel`, `concernStatusBadge`, `renderSendPlanPanel` utility functions.
- Safeguarding eyebrow colour in Styles.html.

### Tests (`tests/worker.test.js`)
Added 10 new test cases covering:
- Concern closure requires outcomeSummary
- Closing an already-closed concern rejected
- concerns.close permission enforced
- send.manage permission enforced for SEND plans
- Invalid planType rejected
- Invalid referral_type rejected
- Safeguarding concerns auto-marked safeguarding confidentiality
- DSL panel not queried without concerns.review
- DSL panel queries safeguarding concerns for concerns.review holders
- Referral fields redacted at summary visibility
- Enum constant exports

### Docs
- `doctrine/concern-workflow.md`: closure flow, referral tracking, redaction rules
- `doctrine/data-model.md`: send_plans, external agency, chronology enrichment
- `HANDOVER.md`: full update

## Remaining gaps (next phase)
- Attendance data import from MIS (CSV script, not UI)
- `agency_contacts` table wire-up
- Behaviour incident type / sanction type on concern form
- Spreadsheet backfill import script
