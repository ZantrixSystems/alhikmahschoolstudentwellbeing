# Migration Path Toward A Future MIS

## Reusable Assets

- Neon relational schema
- role and permission model
- team visibility model
- chronology and casework events
- structured filtering grammar

## Migration Strategy

- keep business rules in backend services rather than Apps Script
- maintain stable API contracts where possible
- isolate UI presentation from persistence model
- favour explicit IDs and timestamps for eventual integration pipelines
- keep the Worker API private now, but shape it like the future MIS service boundary
- migrate Apps Script screens gradually to a full MIS front end when the product is ready
