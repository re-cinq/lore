# Tasks: Hippo-Memory Adaptations

| Field  | Value |
|--------|-------|
| Status | Draft |

## Phase 1: Schema + Retrieval Strengthening

- [ ] T001 Add `last_retrieved_at` and `retrieval_count` columns to `memory.memories` in `setup-memory-schema.sh`
- [ ] T002 Add `confidence`, `last_retrieved_at`, `retrieval_count` columns to `memory.facts` in `setup-memory-schema.sh`
- [ ] T003 Add indexes for decay job ordering on both tables
- [ ] T004 Verify `MemorySearchResult` type exposes memory `id` (UUID); add if missing
- [ ] T005 Add async fire-and-forget `retrieval_count` / `last_retrieved_at` UPDATE in `searchMemories()` after RRF merge
- [ ] T006 Update `scoreImportance()` in `memory-lifecycle.ts` to add +1 for `retrieval_count >= 5` and +1 for `last_retrieved_at` within 7 days

## Phase 2: Epistemic Confidence Tiers

- [ ] T007 Add `OBSERVED_PATTERN` regex and `assignConfidence()` helper in `facts.ts`
- [ ] T008 Pass `confidence` value into `storeFacts()` INSERT in `facts.ts`
- [ ] T009 Add async `confidence` revival UPDATE (stale → observed) for returned fact IDs in `memory-search.ts`
- [ ] T010 Add `staleConfidenceDecayJob()` to `memory-lifecycle.ts` (transition unretrieved facts to `'stale'` after 30 days)
- [ ] T011 Wire `staleConfidenceDecayJob()` into the daily job sequence in `memory-lifecycle.ts`
- [ ] T012 Add `confidence_min` Zod parameter to `search_memory` in `index.ts`
- [ ] T013 Apply `confidence_min` SQL filter in `searchMemories()` in `memory-search.ts`
- [ ] T014 Append `[confidence]` label to fact lines in `context-assembly.ts`

## Phase 3: Conflict Surfacing

- [ ] T015 Add supplementary recently-invalidated-facts query in `context-assembly.ts`
- [ ] T016 Format invalidated facts as `[CONFLICT: "..." was superseded N days ago by "..."]`
- [ ] T017 Append conflict block (max 5 entries) after current facts in context output

## Phase 4: Transfer Scoring

- [ ] T018 Implement `transferScore(factText, key)` utility in `context-assembly.ts`
- [ ] T019 Apply `transferScore` filter and RRF score boost to cross-repo facts in `context-assembly.ts`

## Phase 5: Outcome Feedback Loop

- [ ] T020 Add `task_id` as optional parameter to `assembleContext()` in `context-assembly.ts`
- [ ] T021 Include `memory_keys` array in `assemble_context` audit log metadata
- [ ] T022 Implement `applyOutcomeFeedback()` helper in `loretask-watcher.ts`
- [ ] T023 Call `applyOutcomeFeedback()` in merge-check handler with `+3` (merged) / `-1` (closed) delta
