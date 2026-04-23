# Agent Operating Notes

This repository hosts an interim school student wellbeing platform built on Google Apps Script for the web UI and a Node/Neon backend for secure persistence.

## Delivery Rules

- Preserve the split architecture unless there is a documented reason to change it.
- Keep security boundaries server-side. Never rely on UI-only permission checks.
- Treat all student data as highly sensitive and default to least privilege.
- Preserve the RSQL/FIQL-inspired structured filtering model across frontend and backend.
- Prefer URL-driven state for lists, filters, and saved views.
- Keep the fixed `admin` role immutable in code and data.
- Keep teams separate from roles. Roles grant actions and areas; teams represent operational groups.
- Prefer additive, migration-friendly changes over rewrites.
- Use parameterised SQL only. Never assemble raw SQL from user input.
- Document each meaningful architecture or security change in `Knowledge Base/doctrine`.
- Add a dated journal entry in `Knowledge Base/journals` for each significant work session.
- When making pragmatic interim compromises, record the compromise and the intended migration path.

## Coding Expectations

- Keep Apps Script files modular using HTML includes and small client modules.
- Keep backend code organised by route, service, and shared library.
- Deny by default when a permission or visibility decision is ambiguous.
- Redact detail rather than overexpose data where cross-team visibility is partial.
- Preserve auditability: changes to permissions, visibility, and sensitive records should be journaled or logged.

## Documentation Minimum

For meaningful changes, update:

- Doctrine docs affected by the change
- A dated journal entry
- Handover notes if the change affects deployment, security, or migration planning
