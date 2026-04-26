# 2026-04-26 - Team-Derived Safeguarding Concerns

## Session goal

Remove the visible concern category workflow and use team ownership as the source of truth
for safeguarding confidentiality and referral handling.

## What changed

- `Client.html`: removed the category dropdown from the concern form.
- `Client.html`: Safeguarding referral fields now appear when the selected team has
  `team_key = 'safeguarding'`.
- `Client.html`: behaviour incident and sanction fields are always optional instead of
  being tied to a behaviour category.
- `Client.html`: concern cards no longer display category badges; team ownership is shown instead.
- `worker/index.js`: `createConcern` no longer requires a category from the client.
- `worker/index.js`: create/update derive backend category and confidentiality from the concern team.
  Non-safeguarding concerns use the existing backend category `wellbeing` as the compatibility fallback.
- `worker/index.js`: non-safeguarding callers cannot set safeguarding confidentiality directly.
- `worker/index.js`: the dashboard safeguarding panel now filters by Safeguarding team ownership.

## Security note

The Worker remains the enforcement point. The UI only controls field visibility; the Worker
looks up `teams.team_key` and forces `confidentiality_level = 'safeguarding'` when the team is
Safeguarding.

## Migration path

The `concerns.category` column is retained as a backend compatibility field for now. It can be
removed in a later migration once reporting, tests, and any historical dashboards no longer rely
on it.

## Follow-up access-control fix

- Added soft-delete support for Settings > Users.
- Deleted users are deactivated, assigned roles and teams are removed, and `deleted_at` prevents authentication.
- Re-adding the same email clears `deleted_at` but does not restore old roles or teams.
- Confirmed default access remains none: a user record without assigned roles has no app permissions.

## Follow-up user administration UX

- Consolidated Settings > Users so account details, primary team, team membership, roles, active state, and delete access are handled in one edit form.
- Removed the separate Role Assignment tab from the normal Settings navigation; the dedicated Roles tab remains for defining role permission sets.
- The Worker now accepts `teamIds` and `roleIds` on `/api/settings/users` and replaces the user's assignments in the same save operation.

## Follow-up team sharing deletion

- Added a Delete action to Settings > Team Sharing rows.
- Added `/api/settings/visibility-rules/delete` to soft-delete sharing rules and audit the change.
