# Implementation Plan: Temporal Fact Invalidation

| Field   | Value              |
|---------|--------------------|
| Feature | Temporal Fact Invalidation |
| Spec    | [spec.md](spec.md) |
| Status  | Complete           |
| Created | 2026-04-03         |

## Files Changed

| File | Change |
|------|--------|
| `scripts/infra/setup-memory-schema.sh` | Added `valid_from`, `valid_to`, `invalidated_by` columns to `memory.facts`. Partial index for active facts. ALTER TABLE migrations for existing deployments. |
| `mcp-server/src/facts.ts` | Added `invalidateContradictions()`: embeds new fact, searches existing valid facts with cosine similarity >= 0.92, sets `valid_to` on matches. Fail-open on error. |
| `mcp-server/src/memory-search.ts` | Updated fact queries to filter `valid_to IS NULL` by default. Added `includeInvalidated` parameter. Updated type to include `'episode'` source. |
| `mcp-server/src/memory.ts` | Added `active_facts` and `invalidated_facts` counts to `agentStats`. |
| `mcp-server/src/index.ts` | Added `include_invalidated` parameter to `search_memory` tool. |
