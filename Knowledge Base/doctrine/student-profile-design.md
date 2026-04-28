# Student Profile UX

## Product Principle

The student profile is the operational centre of the interim app.

## Layout

- Compact header with student identity and active radar badges.
- Top horizontal action bar for casework actions.
- Inline action form opens below the action bar and collapses after submit.
- Main centre/left area is the timeline.
- Right side panel contains student details, radar metadata, first-added dates, status, lead, and metadata.

## Actions

- Add note
- Add meeting
- Add concern
- Add follow-up
- Add radar

## Timeline

Timeline entries may represent notes, concerns, meetings, follow-ups, radar changes, and assignment changes. Entries must respect visibility:

- indicator access shows that an event happened
- summary access shows safe metadata and summaries
- full access shows detailed content

The Worker is responsible for redaction. The UI only renders what it receives.
