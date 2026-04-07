# Tasks: Hippo-Memory Adaptations

| Field   | Value      |
|---------|------------|
| Status  | Draft      |
| Created | 2026-04-07 |

## Phase 1: Schema Migrations

- [ ] T001 Add `retrieval_count`, `last_retrieved_at`, `half_life_days` columns to `memory.facts` in `setup-memory-schema.sh`
- [ ] T002 Add `retrieval_count`, `last_retrieved_at`, `half_life_days` columns to `memory.memories` in `setup-memory-schema.sh`
- [ ] T003 Add `confidence` column with CHECK constraint to `memory.facts`
- [ ] T004 Create `memory.fact_conflicts` table with indexes
- [ ] T005 Add `context_refs JSONB` column to `pipeline.tasks`

## Phase 2: Retrieval Strengthening

- [ ] T006 Add `fact_id` field to `RankedRow` and `MemorySearchResult` types in `memory-search.ts`
- [ ] T007 Return `f.id` from `vectorSearchFacts()` and `keywordSearchFacts()` queries
- [ ] T008 Implement `strengthenRetrievals()` — async batch UPDATE of `retrieval_count`, `last_retrieved_at`, `half_life_days` for returned results
- [ ] T009 Wire `strengthenRetrievals()` into `searchMemories()` as fire-and-forget
- [ ] T010 Include stale→observed confidence revival in the retrieval UPDATE

## Phase 3: Confidence Tiers

- [ ] T011 Set `confidence = 'inferred'` in `extractFacts()` INSERT (memory-sourced facts)
- [ ] T012 Verify `confidence = 'observed'` default applies to `extractFactsFromEpisode()` (episode-sourced facts)
- [ ] T013 Add batch UPDATE in `importanceDecayJob()` to transition unretrieved facts to `stale` after 30 days
- [ ] T014 Add `confidence` to `MemorySearchResult` and fact query SELECTs
- [ ] T015 Render confidence annotations in `context-assembly.ts` fact output
- [ ] T016 Include `confidence` in `search_memory` MCP tool response

## Phase 4: Conflict Surfacing

- [ ] T017 Insert `fact_conflicts` record in `invalidateContradictions()` before invalidating old fact
- [ ] T018 Query recent conflicts (7-day window) in `context-assembly.ts` and prefix with `[CONFLICT]`

## Phase 5: Transfer Scoring

- [ ] T019 Implement `computeTransferScore(text)` in `memory-search.ts`
- [ ] T020 Filter cross-repo facts by `transfer_score >= 0.5` in `context-assembly.ts`

## Phase 6: Outcome Feedback

- [ ] T021 Return assembled fact/memory IDs from `assembleContext()` (add `include_ids` option)
- [ ] T022 Store `context_refs` JSONB on `pipeline.tasks` at task creation time
- [ ] T023 In `merge-check`, on PR merge: boost `half_life_days += 5` on contributing facts/memories
- [ ] T024 In `merge-check`, on PR rejection: reduce `half_life_days -= 3` (min 7) on contributing facts/memories
- [ ] T025 Audit log outcome feedback events

## Phase 7: Updated Importance Scoring

- [ ] T026 Rewrite `scoreImportance()` in `memory-lifecycle.ts` to use half-life decay model
- [ ] T027 Update decay job candidate query to include `last_retrieved_at`, `half_life_days`, `retrieval_count`
- [ ] T028 Add stale-confidence penalty (-1) to importance scoring

## Testing

- [ ] T029 Unit tests for `computeTransferScore()` with portable/local keyword combinations
- [ ] T030 Unit tests for new `scoreImportance()` with various half-life/retrieval scenarios
- [ ] T031 Integration test: search → retrieval strengthening → verify updated counts
- [ ] T032 Schema migration idempotency test (run setup-memory-schema.sh twice)
