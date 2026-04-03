# Tasks: Passive Episode Ingestion

| Field   | Value    |
|---------|----------|
| Status  | Complete |
| Created | 2026-04-03 |

- [x] T001 Create `memory.episodes` table with content hash dedup index
- [x] T002 Add `episode_id` column to `memory.facts`, make `memory_id` nullable
- [x] T003 Add `facts_source_check` constraint (memory_id OR episode_id)
- [x] T004 Add FK from `memory.facts.episode_id` to `memory.episodes.id`
- [x] T005 Implement `extractFactsFromEpisode()` in `facts.ts`
- [x] T006 Implement `write_episode` MCP tool with content hash dedup
- [x] T007 Implement `list_episodes` MCP tool with fact count subquery
- [x] T008 Wire async fact extraction on `write_episode`
- [x] T009 Wire async graph extraction on `write_episode`
- [x] T010 Update fact search queries to LEFT JOIN episodes
- [x] T011 Return `source: 'episode'` for episode-derived facts in search results
- [x] T012 Audit log for `write_episode` operations
