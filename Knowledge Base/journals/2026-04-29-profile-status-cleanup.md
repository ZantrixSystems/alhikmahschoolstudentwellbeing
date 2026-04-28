# 2026-04-29 - Profile Status Cleanup

## Context

Student lifecycle management has moved into Settings / Student Management, where staff can import students and bulk-set active or inactive status. The student profile still exposed a legacy "Update status" action, which confused casework status with student record lifecycle status.

## Changes

- Removed the profile-level "Update status" action from the student profile action bar.
- Removed the unused profile status form and client handler.
- Removed the private `/api/students/status` route and handler from the Worker.
- Left Settings Student Management bulk status updates intact, but narrowed student lifecycle options to active/inactive.
- Updated profile/data-model doctrine to make the split explicit: casework is managed through cases/radar, student lifecycle status is managed in Settings.
- Updated handover test notes so profile testing no longer includes a status-change action.

## Product Decision

Open cases and explicit radar records determine whether a student is on a team's casework radar. `students.current_status` is a student-record lifecycle field and should not be changed from the casework profile. Monitoring remains a case/radar concept, not a student lifecycle status.
