# Tasks: Agent Runtime Memory

| Field   | Value                                |
|---------|--------------------------------------|
| Feature | Agent Runtime Memory                 |
| Branch  | 2-agent-memory                       |
| Plan    | [plan.md](plan.md)                   |
| Spec    | [spec.md](spec.md)                   |
| Created | 2026-03-29                           |
| Updated | 2026-04-20 (spec drift reconciliation) |

> **Reconciliation note (2026-04-20):** This file was 100% divergent from
> the shipped implementation. Original tasks were restructured to reflect
> what was actually built. Deferred items are marked. Unplanned features
> added during implementation are listed in Phase 12.

## User Story Map

| Story | Spec Scenario                  | Priority | Phase | Status   |
|-------|--------------------------------|----------|-------|----------|
| US1   | Write and Recall a Memory      | P1       | 1     | Shipped  |
| US2   | Memory Versioning              | P1       | 1     | Shipped  |
| US3   | Memory Search Quality          | P1       | 1     | Shipped  |
| US4   | Fact Extraction                | P2       | 2     | Shipped  |
| US5   | Shared Memory Between Agents   | P2       | 2     | Deferred — pools table exists in schema; MCP tools (`shared_write`/`shared_read`) not registered |
| US6   | Crash Recovery (Snapshots)     | P2       | 2     | Deferred — `create_snapshot`/`restore_snapshot` not registered; schema table present |
| US7   | Memory TTL and Expiration      | P2       | 2     | Shipped  |
| US8   | Monitoring and Inspection (UI) | P3       | 3     | Shipped (scope expanded — see Phase 10) |

---

## Phase 1: Setup

- [x] T001 Create memory schema DDL script in scripts/infra/setup-memory-schema.sh
- [x] T002 Run schema DDL: create memory.memories, memory.memory_versions, memory.facts, memory.snapshots, memory.shared_pools, memory.audit_log tables with indexes in the existing lore database
- [x] T003 [P] Create mcp-server/src/agent-id.ts: resolve agent ID from explicit param → LORE_AGENT_ID env → ~/.lore/agent-id file → generate UUID
- [x] T004 [P] Update scripts/install.sh to generate ~/.lore/agent-id (UUID) between beads init and AgentDB steps
- [x] T005 [P] Update scripts/lore-doctor.sh to check ~/.lore/agent-id exists

---

## Phase 2: Foundational — Memory Module

- [x] T006 Create mcp-server/src/memory.ts: PostgreSQL-backed memory CRUD (writeMemory, readMemory, deleteMemory, listMemories) using the memory schema. Import agent-id.ts for ID resolution. Log all operations to memory.audit_log.
- [x] T007 Create mcp-server/src/memory-file.ts: file-backed fallback for all memory operations. Store as JSON in ~/.lore/memory/<agent-id>/. Substring search instead of vector search. Same function signatures as memory.ts.
- [x] T008 Create mcp-server/src/memory-search.ts: semantic search over memories using Vertex AI embeddings + HNSW vector search + keyword fallback. Search both memories and facts tables. Return results with similarity scores.

---

## Phase 3: US1 — Write and Recall a Memory [P1]

### Story Goal
An agent writes a memory in one session and retrieves it by semantic
search in a later session, without any manual loading.

### Independent Test Criteria
- write_memory returns version 1 with agent ID.
- read_memory returns the stored value.
- search_memory returns the memory when queried with related terms.
- Memory persists after MCP server restart.

### Tasks

- [x] T009 [US1] Register write_memory MCP tool in mcp-server/src/index.ts: calls writeMemory from memory.ts, generates embedding via getQueryEmbedding, falls back to memory-file.ts when DB unavailable
- [x] T010 [US1] Register read_memory MCP tool in mcp-server/src/index.ts: calls readMemory, supports version parameter ("all" for history)
- [x] T011 [US1] Register delete_memory MCP tool in mcp-server/src/index.ts: calls deleteMemory (soft-delete)
- [x] T012 [US1] Register list_memories MCP tool in mcp-server/src/index.ts: calls listMemories with pagination
- [x] T013 [US1] Register search_memory MCP tool in mcp-server/src/index.ts: calls searchMemory from memory-search.ts, scoped by agent_id or pool

---

## Phase 4: US2 — Memory Versioning [P1]

### Story Goal
Every write to an existing key creates a new version. All versions
preserved and queryable. Latest returned by default.

### Independent Test Criteria
- Second write to same key returns version 2.
- read_memory(key, version="all") returns both versions.
- Concurrent writes both succeed (last-write-wins).

### Tasks

- [x] T014 [US2] Implement version increment logic in memory.ts writeMemory: insert into memory_versions on every write, update memories row to latest version
- [x] T015 [US2] Implement version history query in memory.ts readMemory: support version="all" returning array sorted by version desc
- [x] T016 [US2] Implement last-write-wins in memory.ts: concurrent writes both create versions, latest timestamp wins default read

---

## Phase 5: US3 — Memory Search Quality [P1]

### Story Goal
Search returns relevant memories ranked by semantic similarity in
under 100ms. Works across all agent memories simultaneously.

### Independent Test Criteria
- search_memory("greeting") finds memory with value "hello world".
- Results include similarity score.
- Cross-agent search works when agent_id is omitted.
- Sub-100ms latency for 10,000 memories.

### Tasks

- [x] T017 [US3] Implement hybrid search in memory-search.ts: HNSW vector search on memories.embedding + facts.embedding, keyword fallback via search_tsv, Reciprocal Rank Fusion, respects is_deleted and expires_at filters
- [x] T018 [US3] Add cross-agent search: when agent_id is omitted, search across all agents. When pool is specified, scope to pool entries only.
- [x] T019 [US3] Implement file-backed search in memory-file.ts: case-insensitive substring match across all memory values for the agent

---

## Phase 6: US4 — Fact Extraction [P2]

### Story Goal
Unstructured text is automatically broken into individual searchable
facts. Each fact independently searchable via semantic search.

### Independent Test Criteria
- write_memory with extract_facts=true stores raw text AND extracted facts.
- search_memory finds individual facts, not just the raw paragraph.
- Extraction is async — write returns immediately.
- When LLM is down, write succeeds without facts.

### Tasks

- [x] T020 [US4] Create mcp-server/src/facts.ts: async fact extraction via configurable LLM (LORE_FACT_LLM env: claude/openai/ollama). Prompt extracts individual facts. Stores each in memory.facts with embedding. Retry queue (3 attempts, exponential backoff).
- [x] T021 [US4] Update write_memory in memory.ts: when extract_facts=true, queue async fact extraction after write succeeds. Log extraction status to audit_log.
- [x] T022 [P] [US4] Update search_memory in memory-search.ts: include facts table in vector search, merge with memory results via RRF, indicate source="fact" in results

---

## Phase 7: US5 — Shared Memory Between Agents [P2] ⚠ DEFERRED

### Story Goal
Multiple agents share findings through named memory pools without
custom integration code.

### Status
Schema tables (`memory.shared_pools`) are present. MCP tools
`shared_write` and `shared_read` were planned but not registered in
the final implementation. The `search_memory` `pool` parameter works
for pool-scoped search. Full pool CRUD tools remain deferred.

### Tasks

- [x] T023 [US5] Schema: memory.shared_pools table created in setup-memory-schema.sh
- [x] T024 [US5] Register shared_write MCP tool — resolved as deferred (see Status above; pool CRUD not shipped)
- [x] T025 [US5] Register shared_read MCP tool — resolved as deferred (see Status above)
- [x] T026 [P] [US5] search_memory pool parameter: scopes search to pool entries

---

## Phase 8: US6 — Crash Recovery [P2] ⚠ DEFERRED

### Story Goal
Agent crashes and is fully restored from a snapshot in under 1
second with zero data loss.

### Status
Schema table (`memory.snapshots`) is present but `create_snapshot`
and `restore_snapshot` MCP tools were not registered in the final
implementation. Deferred in favor of the lifecycle management system
(ADR-014) which addresses durability through importance decay and
episode-backed fact re-extraction rather than snapshot/restore.

### Tasks

- [x] T027 [US6] Schema: memory.snapshots table created in setup-memory-schema.sh
- [x] T028 [US6] Register create_snapshot MCP tool — resolved as deferred (see Status above; superseded by ADR-014 lifecycle management)
- [x] T029 [US6] Register restore_snapshot MCP tool — resolved as deferred (see Status above)

---

## Phase 9: US7 — Memory TTL and Expiration [P2]

### Story Goal
Temporary memories expire automatically and are excluded from search.

### Independent Test Criteria
- Memory with TTL is excluded from search after expiration.
- Permanent memories never auto-deleted.
- Cleanup job removes expired memories.

### Tasks

- [x] T030 [US7] Implement TTL in memory.ts writeMemory: compute expires_at from ttl_seconds, add to partial index filter
- [x] T031 [US7] TTL cleanup: handled by memory-lifecycle job in agent/src/jobs/memory-lifecycle.ts (replaces planned k8s/memory-ttl-cronjob.yaml; runs as in-process cron via registerJob)
- [x] T032 [US7] Register agent_stats MCP tool in mcp-server/src/index.ts: returns total_memories, total_facts, total_searches, memories_by_day from audit_log
- [x] T033 [US7] Register agent_health MCP tool — resolved as deferred (agent_stats covers this use case)

---

## Phase 10: US8 — Monitoring and Inspection (Web UI) [P3]

### Story Goal
Platform engineers and non-developers have a web interface to browse
agent memories, search, view audit trail, manage shared pools, and
add tasks/specs without using Claude Code.

### Shipped Routes

- [x] T034 [US8] Initialize web-ui/ Next.js project with App Router, TypeScript, shadcn/ui, NextAuth.js (Google Workspace OIDC)
- [x] T035 [US8] Create web-ui/src/lib/db.ts: PostgreSQL connection to lore database with read-only lore_ui user, query helper functions
- [x] T036 [US8] Create web-ui/src/lib/auth.ts: Google Workspace OIDC via NextAuth.js, restrict to configured domain
- [x] T037 [P] [US8] Create web-ui/src/app/page.tsx: Agent overview — list all agents with memory_count, last_active, snapshot_count, link to drill-in
- [x] T038 [P] [US8] Create web-ui/src/app/agents/[id]/page.tsx: Memory browser — paginated list of memories with expand for version history + facts
- [x] T039 [P] [US8] Create web-ui/src/app/audit/page.tsx: Filterable audit trail (agent, operation, date range), paginated
- [x] T040 [P] [US8] Create web-ui/src/app/pools/page.tsx + pools/[name]/: Shared pools browser with entry counts, drill-in, pool-scoped search
- [x] T041 [P] [US8] Create web-ui/src/app/episodes/page.tsx: Browse ingested episodes (added beyond original spec)
- [x] T042 [P] [US8] Create web-ui/src/app/graph/page.tsx: Knowledge graph visualization (added beyond original spec)
- [x] T043 [US8] Create web-ui/src/app/gaps/page.tsx: Review gap detection draft PRs (fetch from GitHub API), approve/reject actions
- [x] T044 [US8] Create Dockerfile for web-ui in web-ui/Dockerfile
- [x] T045 [US8] Build and push web-ui image to ghcr.io/re-cinq/lore-ui
- [x] T046 [US8] Create K8s deployment manifest in k8s/lore-ui-deployment.yaml

> **Note:** Original plan included `/specs`, `/search`, and `/tasks` UI
> pages. The `/context` route ships instead. `/specs` read-only browse
> is handled elsewhere in the UI.

---

## Phase 11: Polish & Cross-Cutting Concerns

- [x] T047 Rebuild and push MCP server image (ghcr.io/re-cinq/lore-mcp) with all memory tools
- [x] T048 Redeploy MCP server to GKE (kubectl rollout restart)
- [x] T049 Memory lifecycle cron deployed as in-process registerJob (replaces planned k8s/memory-ttl-cronjob.yaml)
- [x] T050 Update CLAUDE.md and teams/platform/CLAUDE.md to document memory tools
- [x] T051 Update lore-doctor.sh with memory schema health check
- [x] T052 Re-seed database with updated repo content + generate embeddings

---

## Phase 12: Unplanned Additions (Built During Implementation)

These features were not in the original spec but were added during
implementation. They supersede or extend the planned design.

### Episodes System (see also ADR-014)

- [x] T053 Create memory.episodes table: agent_id, content, content_hash (unique per agent), source, ref, embedding. Dedup on content_hash.
- [x] T054 Register write_episode MCP tool: ingest raw text, store episode, trigger async fact extraction + knowledge graph extraction. Privacy-filtered before storage.
- [x] T055 write_episode triggers async extractFactsFromEpisode (mcp-server/src/facts.ts) and extractAndUpdateGraph (mcp-server/src/graph.ts)

### Live Knowledge Graph (see also ADR-014)

- [x] T056 Create memory.entities and memory.edges tables: typed entities (service/team/technology/concept/person), typed edges (uses/owns/depends-on/replaced-by/part-of/implements), temporal validity
- [x] T057 Create mcp-server/src/graph.ts: extractAndUpdateGraph(), queryLiveGraph(). Contradiction detection invalidates conflicting edges on upsert.
- [x] T058 Register query_graph MCP tool: query entities by name/relation/repo, optional include_invalidated for history

### Fact Confidence Tiers

- [x] T059 Add confidence column to memory.facts: verified/observed/inferred/stale. Defaults to "observed" on episode extraction, "inferred" on memory-sourced extraction.
- [x] T060 Stale transition: daily lifecycle job transitions unretrieved facts (30+ days) to stale. Stale facts get -1 importance penalty.
- [x] T061 search_memory confidence annotations: results include confidence field; stale facts included in results with annotation

### Fact Conflict Detection

- [x] T062 Create memory.fact_conflicts table: records when a new fact contradicts an existing one (cosine similarity ≥ 0.92)
- [x] T063 Contradiction detection in facts.ts: on new fact write, check similarity against existing facts; if ≥ 0.92 threshold, invalidate old fact and write conflict record
- [x] T064 Context assembly surfaces [CONFLICT] prefix on facts with recent (7-day) conflicts

### Retrieval Strengthening

- [x] T065 Async retrieval increment in memory-search.ts: every search_memory call fire-and-forgets UPDATE on returned facts/memories — increments retrieval_count, updates last_retrieved_at, extends half_life_days (+2, cap 365). Stale facts revive to "observed".

### Memory Lifecycle Management (see also ADR-014)

- [x] T066 Create agent/src/jobs/memory-lifecycle.ts: importance decay job (5 AM daily) — scores memories 0-10 based on recency/content/key pattern; evicts lowest-scoring when agent exceeds 500 memories; cleans invalidated facts older than 30 days beyond 2000 cap
- [x] T067 Automatic fact consolidation job (5:30 AM daily) in memory-lifecycle.ts: groups recent facts (7-day lookback) by repo, calls Haiku to extract 1-3 higher-level patterns per repo, stores as consolidated/{repo}/{timestamp} memories. Minimum 5 facts to trigger.

### Passive Session Capture (see also ADR-014)

- [x] T068 Create mcp-server/src/session-tracker.ts: passive session tracking — 500-entry ring buffer of all MCP tool calls, per-session stats, exit dump to ~/.lore/last-session.json
- [x] T069 Stop hook POSTs ~/.lore/last-session.json to /api/session-summary for automatic episode + fact extraction. No agent cooperation needed.

### Post-Task Auto-Curation (see also ADR-014)

- [x] T070 Create agent/src/lib/episode-writer.ts: shared episode writer. After every task completion (PR, no-changes, failure), writes episode via write_episode REST path.
- [x] T071 High-signal events (PR created, task failure): Haiku extracts "lesson learned" and stores as auto-curation/{ref} memory entry.

### Privacy Filtering

- [x] T072 Implement sanitizeContent() / redactSecrets() in mcp-server/src/index.ts: strips API keys, JWTs, private keys, connection strings, and bearer tokens before all memory writes (episodes, memories, both MCP tool and REST API paths)

---

## Dependencies

```
Phase 1 (Setup: schema + agent ID)
  └── Phase 2 (Foundational: memory module + file fallback + search)
        ├── Phase 3 (US1: Write + Recall) ── T009-T013
        │     └── Phase 4 (US2: Versioning) ── T014-T016
        │           └── Phase 5 (US3: Search Quality) ── T017-T019
        ├── Phase 6 (US4: Fact Extraction) ── T020-T022
        │     └── Phase 12 (Episodes + Graph + Confidence + Conflicts)
        ├── Phase 7 (US5: Shared Pools — DEFERRED)
        ├── Phase 8 (US6: Snapshots — DEFERRED)
        └── Phase 9 (US7: TTL + Health) ── T030-T033
              └── Phase 10 (US8: Web UI) ── T034-T046
```

## Summary

| Metric                              | Value         |
|-------------------------------------|---------------|
| Total tasks (incl. additions)       | 72            |
| Original planned tasks              | 52            |
| Unplanned additions (Phase 12)      | 20            |
| Shipped                             | 67            |
| Deferred                            | 5 (shared_write, shared_read, create_snapshot, restore_snapshot, agent_health) |
| Deferred features still in schema   | shared_pools, snapshots tables present |
| User stories fully shipped          | 6/8           |
| User stories deferred               | US5 (partial), US6 (deferred) |
