# 2026-04-24 Hybrid Worker Beta

## Why We Changed

The interim wellbeing app contains sensitive student casework data. Direct Neon access from Apps Script was too much responsibility in the UI host, even though browser code never saw credentials. The hybrid model gives a clearer security boundary while preserving Apps Script as the only staff-facing application.

## Architecture Decision

- Apps Script remains the school-facing web app and Google Workspace identity surface.
- Cloudflare Worker is private infrastructure only.
- Apps Script signs every Worker request with a shared secret.
- Neon credentials moved out of Apps Script and into Worker secrets.
- The Worker enforces permissions, structured filtering, team visibility, response shaping, and audit logging.

## UI Changes

- Removed oversized internal page wording and compacted the app shell.
- Removed the standalone Concerns navigation item for now.
- Reworked the student list into a dense table with radar badges, lead, latest activity, and status.
- Added friendly filter builder plus advanced structured filter input.
- Reworked student profile around a top action bar and central timeline.
- Moved profile/radar metadata into the right-hand panel.
- Changed meetings into a lightweight calendar/list view.
- Compact settings tabs for users, roles, teams, visibility, saved filters, and audit.

## Data And Defaults

- Added migration `006_hybrid_beta_defaults.sql`.
- Default radar labels now include Safeguarding, SENDCO / SEN, Pastoral, and Behaviour Management.
- Caseworker role gains `students.manage` for beta student creation.

## Remaining Incomplete

- Add automated tests for Worker route permissions, redaction, and filter parsing.
- Add persistent nonce replay protection if required.
- Expand follow-up calendar handling beyond the current lightweight view.
- Consider PostgreSQL RLS or a reduced-privilege runtime database role for further hardening.

## Deployment Follow-Up

On 2026-04-24 the Worker and Apps Script production deployment were deployed. `clasp run` could not invoke a property-setting helper because the Apps Script Execution API path was not permitted for this project. The production version was therefore aligned with the Worker bridge secret at deployment time, then the local source was scrubbed back to property-based configuration. Migration path: set `WORKER_API_URL` and `WORKER_SHARED_SECRET` as Apps Script script properties before the next clean Apps Script redeploy.

## Beta Hardening Follow-Up

- Added persistent nonce replay protection through `signed_request_nonces`.
- Added Worker tests for permission enforcement, response redaction, structured filters, team visibility, and nonce replay.
- Extended follow-ups to carry visibility metadata and appear in the calendar alongside meetings.
- Calendar/list views now expose assigned user, status, date, linked student, and item type where permitted.
- PostgreSQL RLS remains deferred as a later hardening option rather than part of this beta pass.

## UI Polish Follow-Up

- Removed developer-facing UI language from the app shell, header, sidebar, dashboard, settings, audit, and loading/error states.
- Compacted the shared page header so Dashboard, Students, Calendar, and Settings use a stable low-height header.
- Improved student list density with a shorter directory panel, compact controls, denser rows, and table skeleton loading.
- Changed Students filters to a Builder/Advanced mode pattern with active chips, clear filters, saved views, and an advanced filter input only when selected.
- Slimmed Dashboard KPI tiles and replaced the dashboard filter examples panel with upcoming follow-ups visible to the signed-in user.
- Kept Calendar and Settings compact with stable skeleton loading to reduce layout jump while data loads.
- Fixed profile timeline duplication by carrying chronology source references and suppressing raw records already represented by chronology events.
