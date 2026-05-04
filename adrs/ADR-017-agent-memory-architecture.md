---
adr_number: 17
title: "Agent memory architecture — PostgreSQL-native store, episode-first model, deferred pool/snapshot tools"
status: accepted
date: 2026-05-04
domains: [memory, agents, mcp]
---

# ADR-017: Agent memory architecture

## Context

The `2-agent-memory` feature shipped with a 100% divergence from its
original task plan. The original spec assumed:

- Five MCP tools: `write_memory`, `read_memory`, `delete_memory`,
  `search_memory`, `list_memories`
- Three deferred tools: `shared_write`, `shared_read`, `create_snapshot`,
  `restore_snapshot`, `agent_health`
- No episode concept; raw memories were the sole ingestion path
- No knowledge graph; the existing static `graphrag/graph.json` was
  assumed sufficient
- Simple fact extraction on explicit `extract_facts=true`

What shipped diverged on every dimension. The divergence was
intentional and driven by decisions made during implementation that
were never captured in a durable record. This ADR corrects that.

The gap detection that triggered this ADR found
`specs/2-agent-memory/tasks.md` at 100% divergence from the shipped
implementation. The spec and plan files have been updated
post-ship (2026-04-20), but the decisions behind the changes have
not been recorded anywhere.

## Decisions

### 1. PostgreSQL + pgvector as the memory store

The original spec was inspired by Octopodas, a managed cloud memory
service. We evaluated:

- **Octopodas (managed SaaS)** — no self-hosted option; we cannot
  keep org-wide memories in a vendor's cloud.
- **Qdrant / Weaviate** — dedicated vector DBs requiring a new infra
  component; CNPG already runs in the cluster.
- **PostgreSQL + pgvector (chosen)** — already running as `lore-db-1`.
  HNSW indexes give sub-100ms search at 100K+ rows. No new infra.
  Schema isolation via the `memory` schema matches the existing
  schema-per-team pattern. BM25 keyword search via GIN index is
  included at no extra cost.

Consequence: all memory tables live in the `memory` schema in the
existing `lore` PostgreSQL database. Adding a new memory store would
violate the ADR-008 convention of single-store-per-domain.

### 2. Episode-first ingestion model

The original design treated `write_memory` as the primary ingestion
path. Experience with the gap-fill and review task flows showed that
agents frequently skip explicit `write_memory` calls — they are
focused on the task at hand and forget to record learnings. The memory
system was therefore always cold.

The solution was to invert the model: raw text blobs (`write_episode`)
become the canonical ingestion path. Facts and knowledge graph updates
are extracted automatically, asynchronously, without requiring the
agent to structure input. Explicit `write_memory` is reserved for
named, structured memories the agent deliberately wants to recall
by key.

This mirrors the ADR-014 passive-capture decision: all MCP tool calls
are tracked in a session ring buffer and POST to `/api/session-summary`
on stop, which calls `write_episode` automatically. Agents need not
cooperate.

Consequence: `write_episode` is the highest-volume write path.
`write_memory` is for named, structured memory. Agents should call
`write_episode` liberally at session end; `write_memory` only for
things they'll want to retrieve by a stable key.

### 3. Not exposing `shared_write` / `shared_read` as MCP tools

The original spec planned two tools for named pool writes. This was
dropped for two reasons:

1. **Friction without benefit.** Agents writing to a shared pool use
   the same write path as private memories; the only distinction is
   the `pool` FK. An extra tool name adds cognitive load without
   adding capability. The `pool=` parameter on `write_memory` and
   `search_memory` is the correct abstraction.

2. **Cross-machine sharing is a DB concern, not an MCP concern.**
   Shared pools work correctly as long as both agents hit the same
   PostgreSQL instance. Making this explicit in the MCP API would
   imply a guarantee Lore cannot make when the file-backed fallback
   is active.

The `memory.shared_pools` table and the internal `sharedWrite` /
`sharedRead` functions were shipped and remain in the implementation.
They are not exposed as registered MCP tools. To write to a shared
pool, agents pass `pool=<name>` on `write_memory`. To read from
a pool, agents pass `pool=<name>` on `search_memory`.

### 4. Not exposing `create_snapshot` / `restore_snapshot` as MCP tools

The spec planned snapshot/restore as a crash-recovery mechanism.
This was superseded before shipping for two reasons:

1. **PostgreSQL WAL is already the durability layer.** Every committed
   write is durable before the response returns. There is no scenario
   where a running agent loses committed memories to a pod crash.
   Snapshots would only help if the agent needed to roll back to a
   prior state — which is not a real use case in practice.

2. **Importance decay solves the actual problem.** The concern driving
   snapshot restore was unbounded memory growth making the agent slow
   and noisy. ADR-014's importance decay + consolidation job addresses
   this directly: low-value memories are evicted, high-value ones
   survive. Snapshot/restore would not have helped here.

The `memory.snapshots` table and the `createSnapshot` function remain
in the implementation for potential future use. They are not exposed
as MCP tools. No agent should depend on them.

### 5. Knowledge graph via PostgreSQL, not a dedicated graph DB

The spec for the adjacent `graph-augmented-search` feature (spec 1)
evaluated Graphiti (hosted) and FalkorDB (self-hosted). Both were
rejected:

- **Graphiti** — hosted-only; same concern as Octopodas.
- **FalkorDB** — another infra component; entity extraction quality
  depends on the same LLM calls we already make; graph queries in
  Cypher add a second query language without meaningful power gain
  for our use case (1-hop entity relationships).

The `memory.entities` and `memory.edges` tables cover entity lookup
and relationship traversal at depth 1, which is the depth used by
`query_graph`. The live graph updates on every `write_episode` call.
This replaced the static `graphrag/graph.json` which required manual
regeneration and was always stale.

Consequence: `query_graph` returns PostgreSQL-backed results, not a
graph-native traversal. For very deep relationship chains (depth > 2),
PostgreSQL recursive CTEs could be used, but this has not been
needed in practice.

### 6. File-backed fallback as transparent degradation

When PostgreSQL is unavailable, memory operations fall back to
`~/.lore/memory/<agent-id>/` JSON files. This was specified and
shipped as designed, with one clarification: the fallback is
transparent to callers — each handler checks `isMemoryDbAvailable()`
internally. Agents do not need to detect or handle the fallback.

Shared pools (`pool=` writes) fall back to
`~/.lore/memory/shared/<pool-name>/`. Cross-machine sharing is not
available during fallback; this is expected behavior, not a bug.

The fallback degrades search quality (case-insensitive substring
matching instead of HNSW vector + BM25 RRF), but reads and writes
remain available. Full search quality recovers automatically when
the database reconnects.

### 7. `agent_health` folded into `agent_stats`

The spec planned two monitoring tools: `agent_health` (status: healthy
/ idle / empty) and `agent_stats` (writes, searches, top keys). The
health data is a subset of the stats data and adds no diagnostic value
beyond what `agent_stats` already returns. Exposing both would have
required callers to make two tool calls for a dashboard view that fits
in one. `agent_health` was dropped; `agent_stats` subsumes it.

## Consequences

**What this means for agents:**

- Use `write_episode` for free-text learnings (session summaries, task
  outcomes, observations). Use `write_memory` only for named, keyed
  memories you want to retrieve by key.
- Shared pool writes use `pool=<name>` on `write_memory`. Pool reads
  use `pool=<name>` on `search_memory`. There is no `shared_write`
  tool.
- Snapshots are not available. Do not attempt to call
  `create_snapshot` — it is not a registered MCP tool.
- Knowledge graph queries use `query_graph` with an entity name. The
  graph is live and updates on every `write_episode` call.

**What this means for operators:**

- The memory schema is fully in PostgreSQL. No separate vector DB or
  graph DB to operate.
- `setup-memory-schema.sh` is idempotent — safe to re-run after any
  migration.
- File-backed fallback state lives in `~/.lore/memory/` on developer
  machines and in the agent pod's ephemeral filesystem. It is not
  shared across machines or pods.

**Known gaps at time of writing:**

- The `/api/context` handler in `routes.ts` does not pass
  `includeIds: true` to `assembleContext()`, so `context_refs` is
  never populated on task creation. The outcome feedback loop in
  ADR-016 (Phase 6) is wired but inert. Fix: one-line change in
  `routes.ts` + forwarding `context_refs` in the task creation path.
- The web UI audit trail (`/audit`) and shared pools browser
  (`/pools`) pages were deferred in Phase 3 in favor of pipeline UI.
  Data exists; UI was not built.
- US5 (dedicated shared pool MCP tools) and US6 (snapshot restore MCP
  tools) remain deferred. The workarounds (pool= parameter, lifecycle
  decay) are production-adequate; re-evaluate if a concrete use case
  appears.

## Relationship to other ADRs

- **ADR-014** (passive memory capture, importance decay, consolidation)
  — the lifecycle layer that made the episode-first model viable.
- **ADR-016** (hippo-memory adaptations) — retrieval strengthening,
  confidence tiers, conflict surfacing, transfer scoring built on
  the schema established by this feature.
