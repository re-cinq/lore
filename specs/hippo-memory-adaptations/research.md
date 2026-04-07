# Research: Hippo-Memory Adaptations

| Field   | Value                                             |
|---------|---------------------------------------------------|
| Source  | https://github.com/kitfunso/hippo-memory          |
| Issue   | re-cinq/lore#205                                  |
| Created | 2026-04-07                                        |

## Summary

`kitfunso/hippo-memory` is a lightweight episodic memory library with
the following design principles:

1. **Retrieval strengthening** — every memory access increments a
   `retrieval_count` and resets a `last_retrieved_at` timestamp.
   The importance scorer uses these signals: a frequently-recalled
   memory is penalized less by age.

2. **Epistemic confidence tiers** — facts carry a `confidence` field
   (`verified | observed | inferred | stale`). Confidence degrades
   over time when a fact is not retrieved; retrieval revives it back
   to `observed`.

3. **Structured handoffs** — on session end, the library serialises
   a compact "working memory" to disk, capturing only items accessed
   this session. On session start, it's rehydrated as a hot-cache.

4. **Transfer scoring** — cross-context fact sharing applies keyword
   heuristics to prefer portable facts (patterns, rules, errors) over
   environment-specific ones (URLs, configs, secrets).

5. **Conflict surfacing** — when a fact is superseded by contradiction,
   the library can optionally emit a `[CONFLICT]` annotation in the
   context output rather than silently hiding the old fact.

## What Lore Already Has

| Hippo Concept             | Lore Equivalent                                    | Gap                                      |
|---------------------------|----------------------------------------------------|------------------------------------------|
| Retrieval strengthening   | None                                               | No `last_retrieved_at` / `retrieval_count` |
| Epistemic confidence      | Temporal validity (`valid_to`)                     | No confidence tier dimension             |
| Structured handoffs       | `~/.lore/last-session.json` (full ring buffer)     | Not filtered to hot-cache                |
| Transfer scoring          | Cross-repo context via `settings.cross_repo_repos` | No portability filter                    |
| Conflict surfacing        | `invalidateContradictions()` — silently resolves   | No visible annotation in context output  |
| Outcome feedback          | `merge-check` job captures PR stats                | Stats not wired into importance scoring  |

## Prioritised Adaptations

| ID | Adaptation                              | Effort | Value | Priority |
|----|-----------------------------------------|--------|-------|----------|
| A  | Retrieval strengthening                 | S      | High  | P1       |
| B  | Epistemic confidence tiers              | M      | High  | P1       |
| C  | Active invalidation from commit messages| M      | Med   | P2       |
| D  | Conflict surfacing in assemble_context  | S      | Med   | P2       |
| E  | Transfer scoring for cross-repo facts   | S      | Med   | P2       |
| F  | Outcome feedback loop                   | M      | Med   | P2       |

Effort: S = ~1 day, M = ~2 days. Value assessed against ADR-014 goals.
