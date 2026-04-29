# 2026-04-29 User Primary Team Cleanup

## Context

`users.primary_team_id` was removed by migration 016, and the runtime user model now uses
`user_teams` for all team membership. The existing-user settings form already followed this
model, but the add-user form still displayed a stale primary team dropdown and sent
`primaryTeamId` in the save payload.

## Changes

- Removed the add-user Primary Team dropdown from Settings > Users.
- Removed the ignored `primaryTeamId` value from the add-user save payload.
- Confirmed the Worker `/api/settings/users` save path only uses `teamIds` and `roleIds`.
- Updated the record ownership migration comment so it no longer references submitter
  primary-team fallback.

## Notes

This is a cleanup of stale UI and documentation only. Server-side team assignment remains
authoritative through `user_teams`, and ambiguous access still denies by default through the
existing Worker permission and visibility checks.
