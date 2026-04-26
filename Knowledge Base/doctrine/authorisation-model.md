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
- User records alone do not grant access; a user requires assigned roles with permissions
- Removing a user in Settings soft-deletes and deactivates the user and removes their roles and teams
- Settings > Users saves account details, team membership, and role assignment together so access changes are applied as one administrative action
- Team sharing rules can be deleted from Settings; deletion is a soft delete so historical audit context remains intact

## Enforcement Layers

- Worker route-level permission checks
- Record-level visibility evaluation for student-linked data
- Content-detail redaction when summary visibility exists without full-detail visibility
- Apps Script UI hiding only for ergonomics, never as the security boundary

## Auditing

- User creation/deletion, role changes, user-role assignments, visibility-rule changes, and sensitive reads are written to `audit_logs`
