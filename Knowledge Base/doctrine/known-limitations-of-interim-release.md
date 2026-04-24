# Known Limitations Of Interim Release

- Current auth foundation relies on Apps Script session context plus signed Worker requests rather than full GIS token verification
- No direct MIS sync yet
- Exports are basic and intended for controlled internal use
- Record-level policies are implemented in app logic, not PostgreSQL RLS
- Student transfer package is placeholder only in this beta
- If the repo design folder is added later, the token layer may need visual alignment work
- Worker nonce replay protection is timestamp-based only in this beta; persistent nonce storage is a future hardening step
