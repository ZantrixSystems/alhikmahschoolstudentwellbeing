# CLAUDE.md

Follow `AGENTS.md` as the primary collaboration contract for this repository.

## Additional Guidance

- Assume this app is an interim production-minded wellbeing platform, not a throwaway prototype.
- Optimise for calm, app-like usability over feature sprawl.
- Keep the student profile as the operational centre of the product.
- Apps Script is the staff-facing shell; the Cloudflare Worker is the private API boundary.
- Never put Neon credentials in Apps Script.
- Enforce sensitive permission and visibility checks in the Worker, not only in the UI.
- Reuse existing architecture and naming where sensible; do not rewrite solely for style.
- If the repo design assets are missing, document the assumption and create a tokenised UI layer that can absorb the intended design later.
- When architecture changes, update doctrine before or alongside code.
- When uncertain on visibility, authorisation, or safeguarding exposure, choose the safer implementation and document the tradeoff.
