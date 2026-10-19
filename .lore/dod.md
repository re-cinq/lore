# Definition of Done

> Two hybrid-search implementations have diverged: the corpus search still has the defects #1924 fixed

**Strategy: `mechanical`** — The ticket requests unifying two divergent implementations of hybrid chunk retrieval into one shared core. This deduplication changes no observable behaviour, so it owes no new acceptance test. The edits themselves and the existing tests staying green are the proof.

## Done when these pass

- [ ] **hybridSearch behavior** — the prior defect fixes for term extraction, normalization, and repo binding remain sound.
  `libs/server-core/src/outbound/db-hybrid-defects.test.ts`
- [ ] **hybridChunkItems behavior** — the original chunk item retrieval logic and ranking remain sound.
  `libs/shared/src/outbound/project/knowledge/context-assembly-chunk-search.contract.test.ts`

## Facets

- [x] Extract the shared SQL construction and RRF logic from `hybridSearch` and `hybridChunkItems` into a single core.
- [x] Add a documented reason for any wrapper functions that remain.

## Out of scope

- Re-evaluating the RRF constants (damping factor of 60).