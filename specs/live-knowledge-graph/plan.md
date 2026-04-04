# Implementation Plan: Live Knowledge Graph

| Field   | Value              |
|---------|--------------------|
| Feature | Live Knowledge Graph |
| Spec    | [spec.md](spec.md) |
| Status  | Complete           |
| Created | 2026-04-03         |

## Files Changed

| File | Change |
|------|--------|
| `scripts/infra/setup-memory-schema.sh` | Added `memory.entities` and `memory.edges` tables. Entities deduped by `(name, entity_type, repo)`. Edges have temporal validity (`valid_from`/`valid_to`). |
| `mcp-server/src/graph.ts` | Added live graph functions alongside legacy static graph: `extractAndUpdateGraph()`, `queryLiveGraph()`, entity upsert, edge upsert with temporal invalidation. |
| `mcp-server/src/index.ts` | Added `query_graph` MCP tool. Wired graph extraction into `write_episode` handler. |
