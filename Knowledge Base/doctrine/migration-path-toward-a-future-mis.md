# Migration Path Toward A Future MIS

## Reusable Assets

- Neon relational schema
- role and permission model
- team visibility model
- chronology and casework events
- structured filtering grammar

## Migration Strategy

- keep business rules in Worker backend services rather than browser code
- maintain stable API contracts where possible
- isolate UI presentation from persistence model
- favour explicit IDs and timestamps for eventual integration pipelines
- keep the Worker API shaped like the future MIS service boundary
- evolve the Worker-served screens gradually into a full MIS front end when the product is ready
