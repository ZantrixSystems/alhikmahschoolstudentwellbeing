# 2026-04-29 - Student Management Dead Code Cleanup

## Context

Student creation and lifecycle management now live in Settings / Student
Management. The Students page is a directory/filter surface, and the student
profile is a casework surface.

## Review Findings

- No current UI calls the legacy single-student `POST /api/students` endpoint.
- No current UI calls the legacy profile delete endpoint
  `POST /api/students/:id/delete`.
- Settings Student Management uses `POST /api/students/import` for creation and
  updates, and `POST /api/students/bulk-status` for active/inactive lifecycle
  changes.

## Changes

- Removed the unused single-student create Worker handler and route.
- Removed the unused student delete Worker handler and route.
- Left the Settings-backed import and bulk-status routes intact.
- Documented that Students is now directory-only, with student record
  maintenance handled in Settings / Student Management.
