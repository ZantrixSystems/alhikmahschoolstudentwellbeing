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

## Multi-Agent Orchestration

When asked to *"use multiple agents"*, *"divvy this up"*, *"work in parallel"*, or when a task is clearly large enough to benefit from parallelism, follow this playbook.

### Lead-and-workers pattern

- **The main session is the lead.** Stay on the top-tier reasoning model (currently Opus 4.7). Do planning, synthesis, code review, and final decisions yourself. Never delegate *understanding* — workers report findings, the lead decides.
- **Workers are spawned via the `Agent` tool**, ideally several in a single message so they run concurrently. Each gets a self-contained brief (no memory of the parent conversation).
- **Workers report back to the lead**, who reconciles results, then either acts or spawns a follow-up wave.

### Model tiering (match the model to the task)

Pass the `model` parameter on each `Agent` call. Cheap models for cheap work; reserve Opus for hard reasoning.

| Tier | Model (`model:` arg) | Use for |
|------|----------------------|---------|
| Heavy | `opus` (4.7) | Architecture design, tricky debugging, security/correctness review, anything where being wrong is expensive. Also the lead. |
| Standard | `sonnet` (4.6) | Most implementation work, moderate refactors, writing tests, non-trivial code edits. Default worker tier. |
| Light | `haiku` (4.5) | Mundane lookups, "where is X defined", file listing, mechanical renames, summarising a doc, simple text edits. Use `Explore` subagent or a plain `Agent` with `model: haiku`. |

Rules of thumb:
- **Default a worker to `sonnet`** unless trivially light (→ `haiku`) or clearly needing deep reasoning (→ `opus`).
- **Never use `opus` for grep/file-find/summarise** — token waste, use `haiku` or `Explore`.
- **If difficulty is ambiguous, split**: send a `haiku` scout first, then escalate.

### When to parallelise vs. stay sequential

- **Parallel** when subtasks are independent (audit migrations + check API routes + review frontend can all run at once).
- **Sequential** when one result feeds the next.
- **Skip agents entirely** for small tasks (one-file edit, quick grep, CSS tweak). Multi-agent overhead is only worth it when the work is genuinely big or parallel.

### Briefing workers

- State **what you're trying to accomplish and why**, not just a narrow command.
- Include exact file paths, line numbers, constraints. Workers can't see the parent conversation.
- Say whether it's **research** (read-only report) or **implementation** (write code).
- Cap report length when only findings are needed: *"Report in under 200 words."*
- **Trust but verify**: when a worker writes code, check the diff yourself before declaring done.

### Coordination & iteration loops

- **Workers don't talk to each other directly** — they can't. All cross-talk is routed through the lead: worker A reports → lead synthesises → lead briefs worker B with relevant findings → repeat.
- **Fix-and-verify loop**: when a worker reports a problem, the lead fixes it or spawns a follow-up worker with the error context, then re-runs the check. Don't declare done until verification passes.
- **Bounded retries**: cap iteration at ~3 attempts on the same failure. If a worker fails the same way twice, the brief or the approach is wrong — stop, re-think, escalate to the user rather than burning tokens.
- **Cross-pollinate findings**: if worker A invalidates worker B's premise, pause B and re-brief with the new info. No stale assumptions.
- **Final synthesis is the lead's**: workers produce raw findings; the lead produces the answer. Never just concatenate worker outputs.

### Token efficiency

- Prefer one well-scoped worker over three overlapping ones.
- Use `Explore` (read-only, cheap) instead of `general-purpose` for pure find/grep/locate.
- Workers return summaries, not raw tool dumps — keeps the lead's context clean.
