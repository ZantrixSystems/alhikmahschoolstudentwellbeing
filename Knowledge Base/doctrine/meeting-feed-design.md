# Calendar And Follow-Ups

## Purpose

Meetings and follow-ups are operational prompts, not just a feed. The beta app presents them as a compact calendar-style surface with a list fallback.

## Visible Fields By Default

- date
- student
- team
- interaction type
- item type, meeting or follow-up
- assigned user
- status
- short summary where permitted

## Visibility

Users only see records permitted by role and team visibility. Summary-only visibility shows safe metadata without sensitive detail. Indicator visibility shows a protected marker only. Profile links always return to the student profile, where the same Worker redaction rules apply.

## Interim Limitation

The current calendar is intentionally lightweight. It combines `meetings.occurred_at` and `actions.due_at`, groups visible dated records, and avoids full scheduling complexity until the full MIS product has a stronger calendar model.
