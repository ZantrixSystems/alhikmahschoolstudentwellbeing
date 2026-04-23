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

## Major Decisions

- Preserve Apps Script as UI host and Node/Neon as secure data tier
- Use internal roles plus separate team visibility rules
- Standardise filtering around an RSQL/FIQL-inspired grammar
- Keep the fixed `admin` role immutable and seed additional operational roles for realistic usage
- Redact cross-team records according to visibility level instead of simply hiding all non-owned records

## Security-Relevant Notes

- Chosen direction is signed Apps Script to backend requests with server-side user resolution
- Authorisation remains deny-by-default
- Profile access and settings mutations now write audit events
- Verified live migrations against Neon and smoke-tested signed `/api/bootstrap` and `/api/students` requests locally

## Assumptions

- The requested `design` folder is not present in the current committed workspace, so a tokenised calm UI layer will be created and documented as an interim visual baseline

## Unfinished Items

- Dedicated UI modules for notes, actions, chronology exports, and reports
- GIS token verification and stronger SSO hardening
- Production deployment pipeline and automated tests
