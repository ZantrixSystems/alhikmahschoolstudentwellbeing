# Beta Handover

## What Works

- Apps Script web app shell with sidebar navigation, dashboard, student directory, student profile, concerns, meetings, settings, and audit tab
- Signed Apps Script to backend request model using API token plus HMAC signature
- Internal user resolution from Google Workspace session email
- Role-based access control with fixed `admin` role and custom role support
- Team model plus team-to-team visibility rules with `none`, `indicator`, `summary`, and `full` levels
- Student single-pane profile with radar badges, chronology, concerns, meetings, and quick-create actions
- RSQL/FIQL-inspired structured filtering on key list APIs
- Neon migrations for wellbeing schema, reference data, sample operational data, and seed roles
- Audit logging for profile reads and settings changes

## Assumptions Made

- The requested `design` folder is not present in the current workspace, so the beta uses a calm tokenised UI layer designed to be easy to realign later
- Apps Script is deployed to a Google Workspace audience where `Session.getActiveUser().getEmail()` is available
- Internal authorisation remains separate from Google authentication through the `users` and role assignment tables

## Incomplete Or Intentionally Light

- No dedicated GIS token verification flow yet; current auth foundation relies on Apps Script-hosted Workspace session context plus signed backend requests
- Notes, actions, exports, and chronology do not yet have their own full list/create screens outside the student profile context
- No automated test suite yet
- No production CI or deployment pipeline was added in this pass
- `.env.local` still needs a real `APPS_SCRIPT_SIGNING_SECRET` set locally to match Apps Script script properties

## Review Next

1. Add a production-grade `APPS_SCRIPT_SIGNING_SECRET` to backend env and Apps Script properties
2. Validate role and team visibility policies with real school scenarios before wider rollout
3. Decide whether to harden further with GIS token verification or keep Apps Script session identity for interim release
4. Expand actions, notes, reports, and export workflows
5. Align the UI to the intended design system once the missing `design` folder assets are available
