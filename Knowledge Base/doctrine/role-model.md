# Role Model

## Fixed Role

- `admin`
  - Immutable
  - Full access to settings, users, permissions, and records

## Custom Roles

Custom roles are stored in the database and managed in-app. Roles can include permissions such as:

- `dashboard.view`
- `students.view`
- `students.manage`
- `concerns.create`
- `concerns.review`
- `meetings.create`
- `chronology.view`
- `settings.roles.manage`
- `settings.teams.manage`

## User Assignment

- Users may hold multiple roles
- Effective permissions are the union of assigned role permissions
- Inactive users are blocked even if roles remain attached
