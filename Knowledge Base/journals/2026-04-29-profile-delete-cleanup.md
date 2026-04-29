# 2026-04-29 - Profile Delete Cleanup

## Context

Student lifecycle administration has moved to Settings / Student Management. The
student profile still showed a destructive "Delete student" button in the same
surface used for notes, meetings, follow-ups, and cases.

## Changes

- Removed the "Delete student" button from the student profile header.
- Removed the profile-only client handler that called the student delete API.
- Updated student profile doctrine to state that the profile is a casework
  surface, not a student-record administration surface.

## Product Decision

Staff should manage student records from Settings / Student Management. The
profile should stay focused on wellbeing casework.
