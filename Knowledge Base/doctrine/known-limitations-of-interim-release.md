# Known Limitations Of Interim Release

- Current auth foundation relies on Google ID token verification in the Worker plus internal app authorisation
- No direct MIS sync yet
- Exports are basic and intended for controlled internal use
- Record-level policies are implemented in app logic, not PostgreSQL RLS
- Student transfer package is placeholder only in this beta
- If the repo design folder is added later, the token layer may need visual alignment work
- PostgreSQL RLS is deliberately deferred as a later hardening option; Worker-side checks remain authoritative for this beta
