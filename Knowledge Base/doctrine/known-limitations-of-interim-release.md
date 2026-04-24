# Known Limitations Of Interim Release

- Current auth foundation relies on Apps Script session context plus signed Worker requests rather than full GIS token verification
- No direct MIS sync yet
- Exports are basic and intended for controlled internal use
- Record-level policies are implemented in app logic, not PostgreSQL RLS
- Student transfer package is placeholder only in this beta
- If the repo design folder is added later, the token layer may need visual alignment work
- Worker nonce cleanup is opportunistic in the request path; scheduled cleanup can be added later if volume grows
- PostgreSQL RLS is deliberately deferred as a later hardening option; Worker-side checks remain authoritative for this beta
