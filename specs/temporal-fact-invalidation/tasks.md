# Tasks: Temporal Fact Invalidation

| Field   | Value    |
|---------|----------|
| Status  | Complete |
| Created | 2026-04-03 |

- [x] T001 Add `valid_from`, `valid_to`, `invalidated_by` columns to `memory.facts` in schema migration
- [x] T002 Add partial index `facts_active_embedding_idx` for active facts (`valid_to IS NULL`)
- [x] T003 Add ALTER TABLE migrations for existing deployments (idempotent)
- [x] T004 Implement `invalidateContradictions()` in `facts.ts` — cosine similarity search + invalidation
- [x] T005 Wire contradiction detection into `extractFacts()` after each fact insert
- [x] T006 Add `LORE_FACT_SIMILARITY_THRESHOLD` env var (default 0.92)
- [x] T007 Update `vectorSearchFacts()` to filter `valid_to IS NULL` by default
- [x] T008 Update `keywordSearchFacts()` to filter `valid_to IS NULL` by default
- [x] T009 Add `includeInvalidated` parameter to `searchMemories()`
- [x] T010 Add `include_invalidated` parameter to `search_memory` MCP tool
- [x] T011 Add `active_facts` and `invalidated_facts` to `agentStats()`
- [x] T012 Log invalidation events in audit_log
- [x] T013 Unit tests for parseFacts and contradiction detection
