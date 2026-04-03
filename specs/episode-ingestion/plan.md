# Implementation Plan: Passive Episode Ingestion

| Field   | Value              |
|---------|--------------------|
| Feature | Passive Episode Ingestion |
| Spec    | [spec.md](spec.md) |
| Status  | Complete           |
| Created | 2026-04-03         |

## Files Changed

| File | Change |
|------|--------|
| `scripts/infra/setup-memory-schema.sh` | Added `memory.episodes` table with content hash dedup. Extended `memory.facts` with `episode_id` FK, made `memory_id` nullable, added CHECK constraint. |
| `mcp-server/src/facts.ts` | Added `extractFactsFromEpisode()` — same pipeline as `extractFacts()` but inserts with `episode_id` instead of `memory_id`. |
| `mcp-server/src/memory-search.ts` | Updated fact queries to LEFT JOIN both `memory.memories` and `memory.episodes`. Returns `source: 'episode'` for episode-derived facts. |
| `mcp-server/src/index.ts` | Added `write_episode` and `list_episodes` MCP tools. `write_episode` stores episode, triggers async fact extraction + graph update. |
