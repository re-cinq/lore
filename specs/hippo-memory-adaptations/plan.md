# Implementation Plan: Hippo-Memory Adaptations

| Field   | Value                                |
|---------|--------------------------------------|
| Feature | Hippo-Memory Adaptations             |
| Spec    | [spec.md](spec.md)                   |
| Status  | Shipped — all phases complete        |
| Created | 2026-04-07                           |
| Updated | 2026-04-20                           |
| Issue   | [re-cinq/lore#205](https://github.com/re-cinq/lore/issues/205) |

## As-Built Summary

All seven phases shipped. The implementation follows the plan closely
with three notable divergences documented below.

## Divergences from Original Plan

| Area | Planned | As Built | Reason |
|------|---------|----------|--------|
| `strengthenRetrievals` — memory lookup key | `WHERE key = ANY($1) AND agent_id = ANY($2)` | `WHERE id = ANY($1)` using UUID | `MemorySearchResult` already carries `id`; UUID lookup is unambiguous and avoids text-matching collisions on duplicate keys across agents |
| Retrieval strengthening call site | After `auditLog()` | Before `auditLog()` (line 119 vs 122 in `memory-search.ts`) | Fire-and-forget was added alongside the graph augmentation block; audit log moved to the end to capture final `results` count including graph-augmented entries |
| `scoreImportance` formula | `score = 5; score += Math.round(strength * 7) - 5` | `score = Math.round(strength * 10)` | Equivalent range (0–10) but the simplified formula is more readable; key/retrieval adjustments are applied after |
| Transfer keywords | `PORTABLE_KEYWORDS` included `migration`; `LOCAL_KEYWORDS` included `cron` | Both omitted | `migration` triggered false positives on common narrative text ("data migration…"); `cron` was flagged only in infra-specific repos and added noise |
| Schema migration location | Proposed new file at `scripts/infra/setup-memory-schema.sh` | Added to the existing file | Schema file already existed; idempotent `ADD COLUMN IF NOT EXISTS` blocks were appended at line 79 — no separate file needed |

## Files Changed (as shipped)

| File | Phase | Change |
|------|-------|--------|
| `scripts/infra/setup-memory-schema.sh` | 1 | Added `retrieval_count`, `last_retrieved_at`, `half_life_days` to `memory.facts` and `memory.memories`; added `confidence` column + CHECK constraint; created `memory.fact_conflicts` table; added `context_refs` to `pipeline.tasks` |
| `mcp-server/src/memory-search.ts` | 2, 5 | Added `id` and `confidence` to `RankedRow` and `MemorySearchResult`; returned `f.id` from vector and keyword fact queries; implemented `strengthenRetrievals()` (fire-and-forget, UUID-based); added `computeTransferScore()` |
| `mcp-server/src/facts.ts` | 3, 4 | Set `confidence = 'inferred'` on memory-sourced fact INSERT; inserted `fact_conflicts` record in `invalidateContradictions()` before invalidating old fact |
| `agent/src/jobs/memory-lifecycle.ts` | 3, 7 | Added batch UPDATE to transition unretrieved facts to `stale` after 30 days; rewrote `scoreImportance()` with `0.5^(age / half_life)` model; updated candidate query to include `last_retrieved_at`, `half_life_days`, `retrieval_count` |
| `mcp-server/src/context-assembly.ts` | 3, 4, 5 | Rendered `[confidence]` prefix on facts in assembled context; added 7-day conflict query and `[CONFLICT]` prefix; filtered cross-repo facts by `computeTransferScore() >= 0.5` |
| `mcp-server/src/index.ts` | 3 | Included `confidence` in `search_memory` MCP tool response |
| `agent/src/jobs/merge-check.ts` | 6 | Read `context_refs`; boosted `half_life_days += 5` on merge, penalised `-3` (min 7) on rejection; wrote audit log events |
| `mcp-server/src/pipeline.ts` (or `routes.ts`) | 6 | Stored `context_refs` JSONB on `pipeline.tasks` at task creation; `assembleContext()` gained `include_ids` flag returning `{ fact_ids, memory_ids }` |

## Known Gap: Conflict Pair Display

The spec required "both the old invalidated and new valid fact are
shown" when a conflict exists. The implementation only marks the
currently-valid (new) fact with `[CONFLICT]`. The invalidated fact
is accessible via `search_memory` with `include_invalidated=true`
but is not proactively surfaced. Acceptable for the initial
rollout; revisit if agents need the contradicted fact text.

## ADR Reference

Extends [ADR-014: Intelligent memory lifecycle](../../adrs/ADR-014-passive-memory-capture.md)
with retrieval strengthening and outcome feedback.
