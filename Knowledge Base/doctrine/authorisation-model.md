# Authorisation Model

## Principles

- Deny by default
- Enforce on the server
- Separate authentication from authorisation
- Prefer explicit permission keys over implicit role behaviour

## Model

- `admin` is a fixed built-in role and cannot be edited or deleted
- Custom roles are editable through Settings
- Roles grant permissions for app areas and actions
- Teams do not grant permissions; they scope operational visibility

## Enforcement Layers

- Worker route-level permission checks
- Record-level visibility evaluation for student-linked data
- Content-detail redaction when summary visibility exists without full-detail visibility
- Apps Script UI hiding only for ergonomics, never as the security boundary

## Auditing

- Role changes, user-role assignments, visibility-rule changes, and sensitive reads are written to `audit_logs`
