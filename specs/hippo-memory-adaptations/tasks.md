# Tasks: Hippo-Memory Adaptations

| Field       | Value      |
|-------------|------------|
| Status      | Implemented |
| Created     | 2026-04-07 |
| Implemented | 2026-04-20 |

## Phase 1: Schema Migrations

- [x] T001 Add `retrieval_count`, `last_retrieved_at`, `half_life_days` columns to `memory.facts` — shipped via existing `scripts/infra/setup-memory-schema.sh:79` (no separate migration file created in the planned location)
- [x] T002 Add `retrieval_count`, `last_retrieved_at`, `half_life_days` columns to `memory.memories` — shipped via `scripts/infra/setup-memory-schema.sh:83`
- [x] T003 Add `confidence` column with CHECK constraint to `memory.facts` — shipped via `scripts/infra/setup-memory-schema.sh`
- [x] T004 Create `memory.fact_conflicts` table with indexes — shipped via `scripts/infra/setup-memory-schema.sh:97-108`
- [x] T005 Add `context_refs JSONB` column to `pipeline.tasks` — shipped via `scripts/infra/setup-memory-schema.sh:111`

## Phase 2: Retrieval Strengthening

- [x] T006 Add `fact_id` field to `RankedRow` and `MemorySearchResult` types in `memory-search.ts`
- [x] T007 Return `f.id` from `vectorSearchFacts()` and `keywordSearchFacts()` queries
- [x] T008 Implement `strengthenRetrievals()` — async batch UPDATE of `retrieval_count`, `last_retrieved_at`, `half_life_days` for returned results
- [x] T009 Wire `strengthenRetrievals()` into `searchMemories()` as fire-and-forget
- [x] T010 Include stale→observed confidence revival in the retrieval UPDATE

## Phase 3: Confidence Tiers

- [x] T011 Set `confidence = 'inferred'` in `extractFacts()` INSERT (memory-sourced facts)
- [x] T012 Verify `confidence = 'observed'` default applies to `extractFactsFromEpisode()` (episode-sourced facts)
- [x] T013 Add batch UPDATE in `importanceDecayJob()` to transition unretrieved facts to `stale` after 30 days
- [x] T014 Add `confidence` to `MemorySearchResult` and fact query SELECTs
- [x] T015 Render confidence annotations in `context-assembly.ts` fact output
- [x] T016 Include `confidence` in `search_memory` MCP tool response

## Phase 4: Conflict Surfacing

- [x] T017 Insert `fact_conflicts` record in `invalidateContradictions()` before invalidating old fact
- [x] T018 Query recent conflicts (7-day window) in `context-assembly.ts` and prefix with `[CONFLICT]` — **partial:** only new fact is marked; old invalidated fact is not shown alongside (see spec notes)

## Phase 5: Transfer Scoring

- [x] T019 Implement `computeTransferScore(text)` in `memory-search.ts`
- [x] T020 Filter cross-repo facts by `transfer_score >= 0.5` in `context-assembly.ts`

## Phase 6: Outcome Feedback

- [x] T021 Return assembled fact/memory IDs from `assembleContext()` (add `include_ids` option)
- [x] T022 Store `context_refs` JSONB on `pipeline.tasks` at task creation time
- [x] T023 In `merge-check`, on PR merge: boost `half_life_days += 5` on contributing facts/memories
- [x] T024 In `merge-check`, on PR rejection: reduce `half_life_days -= 3` (min 7) on contributing facts/memories
- [x] T025 Audit log outcome feedback events

## Phase 7: Updated Importance Scoring

- [x] T026 Rewrite `scoreImportance()` in `memory-lifecycle.ts` to use half-life decay model
- [x] T027 Update decay job candidate query to include `last_retrieved_at`, `half_life_days`, `retrieval_count`
- [x] T028 Add stale-confidence penalty (-1) to importance scoring

## Testing

- [x] T029 Unit tests for `computeTransferScore()` with portable/local keyword combinations
- [x] T030 Unit tests for new `scoreImportance()` with various half-life/retrieval scenarios
- [x] T031 Integration test: search → retrieval strengthening → verify updated counts
- [x] T032 Schema migration idempotency test (run setup-memory-schema.sh twice) — verified via `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` clauses throughout the script
