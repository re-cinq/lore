# Implementation Plan: Graph-Augmented Search

| Field   | Value              |
|---------|--------------------|
| Feature | Graph-Augmented Search |
| Spec    | [spec.md](spec.md) |
| Status  | Complete           |
| Created | 2026-04-03         |

## Files Changed

| File | Change |
|------|--------|
| `mcp-server/src/memory-search.ts` | Added entity name cache (5min TTL), `detectEntities()`, `graphAugment()` for 1-hop neighbors, `graphAugmentEnabled` param on `searchMemories()`. |
| `mcp-server/src/index.ts` | Added `graph_augment` boolean param to `search_memory` MCP tool. |
