# Tasks: Agent Runtime Memory

| Field   | Value                                |
|---------|--------------------------------------|
| Feature | Agent Runtime Memory                 |
| Branch  | 2-agent-memory                       |
| Plan    | [plan.md](plan.md)                   |
| Spec    | [spec.md](spec.md)                   |
| Created | 2026-03-29                           |

## User Story Map

| Story | Spec Scenario                  | Priority | Phase |
|-------|--------------------------------|----------|-------|
| US1   | Write and Recall a Memory      | P1       | 1     |
| US2   | Memory Versioning              | P1       | 1     |
| US3   | Memory Search Quality          | P1       | 1     |
| US4   | Fact Extraction                | P2       | 2     |
| US5   | Shared Memory Between Agents   | P2       | 2     |
| US6   | Crash Recovery (Snapshots)     | P2       | 2     |
| US7   | Memory TTL and Expiration      | P2       | 2     |
| US8   | Monitoring and Inspection (UI) | P3       | 3     |

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

## Phase 7: US5 — Shared Memory Between Agents [P2]

### Story Goal
Multiple agents share findings through named memory pools without
custom integration code.

### Independent Test Criteria
- shared_write creates pool implicitly on first write.
- shared_read returns all entries from a pool.
- search_memory with pool parameter scopes search to pool.
- Different agents can write to the same pool.

### Tasks

- [x] T023 [US5] Register shared_write MCP tool in mcp-server/src/index.ts: creates pool in memory.shared_pools if not exists, writes memory with pool_id set
- [x] T024 [US5] Register shared_read MCP tool in mcp-server/src/index.ts: reads all entries or specific key from a pool
- [x] T025 [P] [US5] Implement file-backed shared pools in memory-file.ts: store in ~/.lore/memory/shared/<pool-name>/

---

## Phase 8: US6 — Crash Recovery [P2]

### Story Goal
Agent crashes and is fully restored from a snapshot in under 1
second with zero data loss.

### Independent Test Criteria
- create_snapshot captures all current memories as references.
- restore_snapshot reverts to snapshotted state.
- Memories created after snapshot are soft-deleted on restore.
- Restore completes in under 1 second for 10,000 memories.

### Tasks

- [x] T026 [US6] Register create_snapshot MCP tool in mcp-server/src/index.ts: queries active memories, stores memory_refs JSONB in memory.snapshots
- [x] T027 [US6] Register restore_snapshot MCP tool in mcp-server/src/index.ts: reads snapshot refs, bulk UPDATE memories to snapshotted versions in single transaction, soft-delete post-snapshot memories
- [x] T028 [P] [US6] Implement file-backed snapshots in memory-file.ts: JSON snapshot of memory state

---

## Phase 9: US7 — Memory TTL and Expiration [P2]

### Story Goal
Temporary memories expire automatically and are excluded from search.

### Independent Test Criteria
- Memory with TTL is excluded from search after expiration.
- Permanent memories never auto-deleted.
- Cleanup job removes expired memories.

### Tasks

- [x] T029 [US7] Implement TTL in memory.ts writeMemory: compute expires_at from ttl_seconds, add to partial index filter
- [x] T030 [US7] Create k8s/memory-ttl-cronjob.yaml: hourly CronJob that hard-deletes expired memories (24h grace period after expiration) and orphaned versions/facts
- [x] T031 [US7] Register agent_health MCP tool in mcp-server/src/index.ts: returns memory_count, last_active, snapshot_count from memory schema
- [x] T032 [P] [US7] Register agent_stats MCP tool in mcp-server/src/index.ts: returns total_memories, total_facts, total_searches, memories_by_day from audit_log

---

## Phase 10: US8 — Monitoring and Inspection (Web UI) [P3]

### Story Goal
Platform engineers and non-developers have a web interface to browse
agent memories, search, view audit trail, manage shared pools, and
add tasks/specs without using Claude Code.

### Independent Test Criteria
- Agent overview shows all agents with correct memory counts.
- Memory browser shows versions and extracted facts.
- Search works across agents with relevance scores.
- Audit trail is filterable by agent, operation, date.
- Non-developer can add a task via the UI.

### Tasks

- [x] T033 [US8] Initialize web-ui/ Next.js project with App Router, TypeScript, shadcn/ui, NextAuth.js (Google Workspace OIDC) in web-ui/
- [x] T034 [US8] Create web-ui/src/lib/db.ts: PostgreSQL connection to lore database with read-only lore_ui user, query helper functions
- [x] T035 [US8] Create web-ui/src/lib/auth.ts: Google Workspace OIDC via NextAuth.js, restrict to configured domain
- [x] T036 [P] [US8] Create web-ui/src/app/page.tsx: Agent overview — list all agents with memory_count, last_active, snapshot_count, link to drill-in
- [x] T037 [P] [US8] Create web-ui/src/app/agents/[id]/page.tsx: Memory browser — paginated list of memories with expand for version history + facts
- [x] T038 [P] [US8] Create web-ui/src/app/search/page.tsx: Cross-agent semantic search with agent/pool scope filter, similarity scores
- [x] T039 [P] [US8] Create web-ui/src/app/audit/page.tsx: Filterable audit trail (agent, operation, date range), paginated
- [x] T040 [P] [US8] Create web-ui/src/app/pools/page.tsx: Shared pools browser with entry counts, drill-in, pool-scoped search
- [x] T041 [US8] Create web-ui/src/app/tasks/page.tsx: View Beads tasks, add new task form (writes via bd create)
- [x] T042 [US8] Create web-ui/src/app/specs/page.tsx: Browse ingested specs from org_shared.chunks, add new spec text
- [x] T043 [US8] Create web-ui/src/app/gaps/page.tsx: Review gap detection draft PRs (fetch from GitHub API), approve/reject actions
- [x] T044 [US8] Create Dockerfile for web-ui in web-ui/Dockerfile
- [x] T045 [US8] Build and push web-ui image to ghcr.io/re-cinq/lore-ui
- [x] T046 [US8] Create K8s deployment manifest in k8s/lore-ui-deployment.yaml: lore-ui namespace, port 3000, Google OIDC secrets, read-only DB user

---

## Phase 11: Polish & Cross-Cutting Concerns

- [x] T047 Rebuild and push MCP server image (ghcr.io/re-cinq/lore-mcp) with all memory tools
- [x] T048 Redeploy MCP server to GKE (kubectl rollout restart)
- [x] T049 Deploy TTL cleanup CronJob (kubectl apply -f k8s/memory-ttl-cronjob.yaml)
- [x] T050 Update CLAUDE.md and teams/platform/CLAUDE.md to document memory tools
- [x] T051 Update lore-doctor.sh with memory schema health check
- [x] T052 Re-seed database with updated repo content + generate embeddings

---

## Dependencies

```
Phase 1 (Setup: schema + agent ID)
  └── Phase 2 (Foundational: memory module + file fallback + search)
        ├── Phase 3 (US1: Write + Recall) ── T009-T013
        │     └── Phase 4 (US2: Versioning) ── T014-T016
        │           └── Phase 5 (US3: Search Quality) ── T017-T019
        ├── Phase 6 (US4: Fact Extraction) ── T020-T022
        ├── Phase 7 (US5: Shared Pools) ── T023-T025
        ├── Phase 8 (US6: Snapshots) ── T026-T028
        └── Phase 9 (US7: TTL + Health) ── T029-T032
              └── Phase 10 (US8: Web UI) ── T033-T046
```

## Parallel Execution Opportunities

### Phase 1 (Day 1)
```
Agent A: T001, T002 (schema)
Agent B: T003 (agent-id.ts) [P]
Agent C: T004 (install.sh) + T005 (doctor) [P]
```

### Phase 2 (Day 2)
```
Agent A: T006 (memory.ts — PostgreSQL backend)
Agent B: T007 (memory-file.ts — file fallback) [P]
Agent C: T008 (memory-search.ts) [P after T006]
```

### Phase 3-5 (Days 3-4)
```
Agent A: T009-T013 (register all 5 core MCP tools)
Agent B: T014-T016 (versioning logic) [P — different functions]
Agent C: T017-T019 (search quality) [P — different file]
```

### Phase 6-9 (Days 5-7)
```
Agent A: T020-T022 (fact extraction) [P]
Agent B: T023-T025 (shared pools) [P]
Agent C: T026-T028 (snapshots) [P]
Agent D: T029-T032 (TTL + health) [P]
```

### Phase 10 (Weeks 3-4)
```
Agent A: T033-T035 (Next.js scaffold + db + auth)
Agents B-F: T036-T043 (UI pages) [P — independent routes]
Agent G: T044-T046 (Docker + deploy)
```

## Implementation Strategy

### MVP (Phase 1-5, ~1 week)
- T001-T019: Core memory CRUD, versioning, semantic search, file fallback.
- 19 tasks. An agent can write, read, search, and version memories.
- Gate: write_memory → search_memory works end-to-end on GKE and locally.

### Phase 2 Increment (~1 week)
- T020-T032: Fact extraction, shared pools, snapshots, TTL, health.
- 13 tasks. Full Octopodas-equivalent feature set (minus dashboard).

### Phase 3 Increment (~2 weeks)
- T033-T046: Web UI for monitoring + non-developer interface.
- 14 tasks. The dashboard that makes Lore accessible to POs/managers.

### Polish (1-2 days)
- T047-T052: Deploy, document, seed.
- 6 tasks.

## Summary

| Metric                       | Value |
|------------------------------|-------|
| Total tasks                  | 52    |
| Phase 1 (Setup) tasks       | 5     |
| Phase 2 (Foundational) tasks | 3     |
| US1-US3 (Core, P1) tasks    | 11    |
| US4-US7 (Advanced, P2) tasks | 13    |
| US8 (Web UI, P3) tasks      | 14    |
| Polish tasks                 | 6     |
| Parallelizable tasks ([P])  | 18    |
| User stories covered         | 8/8   |
