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
