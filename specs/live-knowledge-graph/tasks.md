# Tasks: Live Knowledge Graph

| Field   | Value    |
|---------|----------|
| Status  | Complete |
| Created | 2026-04-03 |

- [x] T001 Create `memory.entities` table with unique index on `(name, entity_type, repo)`
- [x] T002 Create `memory.edges` table with temporal validity columns
- [x] T003 Add partial indexes for active edges (`valid_to IS NULL`)
- [x] T004 Implement `parseGraphExtraction()` — parse LLM output into entities + edges
- [x] T005 Implement `upsertEntity()` — insert or update entity, return ID
- [x] T006 Implement `upsertEdge()` — insert edge, invalidate contradictory edges
- [x] T007 Implement `extractAndUpdateGraph()` — LLM entity extraction + graph upsert
- [x] T008 Implement `queryLiveGraph()` — query entities/edges with temporal filtering
- [x] T009 Register `query_graph` MCP tool with entity, relation_type, repo, include_invalidated params
- [x] T010 Wire graph extraction into `write_episode` handler (async, best-effort)
- [x] T011 Unit tests for graph extraction parsing and edge invalidation
