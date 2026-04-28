# Team Visibility Model

## Separation of Concerns

- Roles answer: what can this user do
- Teams answer: which operational unit owns or can view which student records

## Visibility Levels

Rules are defined per source team, target team, and content type.

- `none`
- `indicator`
- `summary`
- `full`

## Content Types

- radar
- concerns
- meetings
- notes
- actions
- chronology

## Intended Behaviour

- A team may know another team is involved without seeing detail
- Summary visibility can expose safe metadata such as event type, date, and owning team
- Full visibility can expose detailed narrative content

## Enforcement

- Applied record-by-record in Worker services
- Redacted payloads are returned when summary-only access exists
- The browser receives already-shaped records and must not attempt to expand visibility client-side
- Safeguarding concern visibility is derived server-side from team ownership:
  `teams.team_key = 'safeguarding'` forces `concerns.confidentiality_level = 'safeguarding'`
  and drives the safeguarding dashboard query.
