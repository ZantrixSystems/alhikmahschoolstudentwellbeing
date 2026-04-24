# 2026-04-23 Beta Build

## What Was Built

- Established agent guidance in `AGENTS.md` and `CLAUDE.md`
- Created doctrine and journals structure for ongoing engineering record-keeping
- Expanded the prototype into a secure wellbeing beta architecture
- Added a full Neon wellbeing schema with roles, permissions, teams, visibility rules, radar, concerns, meetings, chronology, actions, saved filters, and audit logs
- Added seed reference data, sample users, sample students, and operational sample records
- Built signed Apps Script to backend request verification
- Built backend APIs for bootstrap, dashboard, students, profile data, concerns, meetings, settings, and audit logs
- Built Apps Script UI pages for dashboard, student directory, student profile, concerns, meetings, settings, and audit
- Reworked the UI visual system to align with the later-added `design/lightTheme` reference and its "Alabaster Terminal" language
- Migrated the runtime away from Apps Script and Express into a single Cloudflare Worker plus static asset deployment
- Removed the obsolete Apps Script and Express runtime code after the Worker structure was created

## Major Decisions

- Preserve Apps Script as UI host and Node/Neon as secure data tier
- Use internal roles plus separate team visibility rules
- Standardise filtering around an RSQL/FIQL-inspired grammar
- Keep the fixed `admin` role immutable and seed additional operational roles for realistic usage
- Redact cross-team records according to visibility level instead of simply hiding all non-owned records
- Prefer the light theme reference over the dark one for this product because the school wellbeing context benefits from calm warmth over command-deck severity
- Move to Cloudflare Worker because the product benefits from a single real application URL and a cleaner deployment/runtime model than Apps Script

## Security-Relevant Notes

- Chosen direction is signed Apps Script to backend requests with server-side user resolution
- Authorisation remains deny-by-default
- Profile access and settings mutations now write audit events
- Verified live migrations against Neon and smoke-tested signed `/api/bootstrap` and `/api/students` requests locally
- Confirmed Cloudflare account selection and targeted the existing `wellbeing` Worker under `ali.rahman@alhikmahschool.org`

## Assumptions

- The requested `design` folder is not present in the current committed workspace, so a tokenised calm UI layer will be created and documented as an interim visual baseline

## Unfinished Items

- Dedicated UI modules for notes, actions, chronology exports, and reports
- Google OIDC or Cloudflare Access-backed auth in the Worker to replace the bootstrap access path
- Production deployment pipeline and automated tests

## 2026-04-24 Apps Script Return

- Restored Apps Script project files and `.clasp.json` for project `19EBgbNt3I_SEYaYEqr1NQEPtnvHlHH5QO3PsdgGlp2997nHoAmWgHOix`
- Kept Cloudflare Worker as the private Neon API layer rather than putting Neon credentials into Apps Script
- Added Worker verification for signed Apps Script headers: token, timestamp, HMAC signature, and Workspace email
- Set matching Apps Script script properties and Worker secrets for the signed bridge
- Redeployed the existing Apps Script web app deployment as version 11
- Updated doctrine and handover docs to describe the hybrid Apps Script plus Worker architecture
- Follow-up: remove the Worker bootstrap fallback after signed Apps Script traffic has been observed working for all intended users
