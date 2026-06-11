# Feature Specification: Agent Runtime Memory

| Field          | Value                                       |
|----------------|---------------------------------------------|
| Feature        | Agent Runtime Memory                        |
| Branch         | 2-agent-memory                              |
| Status         | Shipped                                     |
| Created        | 2026-03-29                                  |
| Updated        | 2026-04-20 (post-ship drift correction)     |
| Owner          | Platform Engineering                        |

> **Note:** This spec was updated after shipping to reflect the actual
> implementation. Several features from the original design were not
> exposed as MCP tools (shared pools, snapshots), and several
> capabilities were added beyond the original scope (episodes, knowledge
> graph, confidence tiers, retrieval strengthening, decay/consolidation).
> See the [Divergences from Original Design](#divergences-from-original-design)
> section for a full accounting.

## Problem Statement

Lore gives agents access to organizational knowledge — conventions,
ADRs, PR history. But agents have no memory of their own. A Lore
agent that runs gap detection on Monday has no idea what it tried
last Monday. A developer's Claude Code session forgets everything
when it closes. Every agent starts cold, every time.

Octopodas solves this as a managed cloud service. We want the same
capabilities self-hosted, integrated into Lore's existing PostgreSQL
+ pgvector infrastructure, accessible via MCP tools.

## Vision

Every agent — local Claude Code, Lore cluster agent, or future
integrations — has persistent memory that survives sessions, restarts,
and crashes. Memories are versioned, timestamped, semantically
searchable, and can be shared across agents. The system extracts
individual facts from unstructured text so agents find exactly what
they need. A live knowledge graph tracks relationships between entities.
Retrieval strengthens memories and facts that prove useful over time.

## User Personas

### Developer (Claude Code user)

Works in Claude Code daily. Wants Claude to remember preferences,
past decisions, and context from previous sessions without repeating
themselves. Expects it to work automatically — no manual save/load.

### Lore Agent (cluster worker)

Runs background tasks (ingestion, gap detection, spec drift). Needs
to remember what it did in previous runs: what gaps it already
drafted, what specs it already checked, what candidates it tried
and their scores. Without memory, it repeats work or misses patterns
that span multiple runs.

### Platform Engineer (operator)

Manages the Lore infrastructure. Needs to see what agents remember,
debug unexpected agent behavior by inspecting memories, and understand
the current state of the agent knowledge graph.

## Shipped MCP Tools

These are the tools actually registered in the MCP server and
available to agents. They are the authoritative interface.

### Memory CRUD

- **`lore_write_memory(key, value, agent_id?, ttl?, extract_facts?)`** —
  creates or updates a memory. Every write to an existing key creates
  a new version (monotonic). Returns the memory with version number.
  If `extract_facts=true`, fact extraction runs asynchronously and
  does not block the response.

- **`lore_read_memory(key, agent_id?, version?)`** — returns the latest
  version by default. Pass `version="all"` for full version history.

- **`lore_delete_memory(key, agent_id?)`** — soft-deletes (sets `is_deleted`,
  preserved in history but excluded from search).

- **`lore_list_memories(agent_id?, limit?, offset?)`** — paginated listing
  of active (non-deleted, non-expired) memories for an agent.

### Semantic Search

- **`lore_search_memory(query, agent_id?, limit?, pool?, include_invalidated?,
  graph_augment?)`** — hybrid semantic + keyword search over memories
  and extracted facts using Reciprocal Rank Fusion. Results include
  confidence annotations and similarity scores.
  - `include_invalidated=true` enables historical queries (facts
    superseded by later contradictions are included).
  - `graph_augment=true` enriches results with related graph entities.
  - Results are capped at 3 per (agent_id + source) combo to prevent
    verbose sessions from dominating (session diversification).
  - Every search call asynchronously increments `retrieval_count`,
    updates `last_retrieved_at`, and extends `half_life_days` (+2,
    cap 365) on returned facts and memories.

### Episode Ingestion

- **`lore_write_episode(text, agent_id?, repo?, source?)`** — ingests raw
  text (conversation turns, code reviews, observations). Fact
  extraction runs asynchronously. Knowledge graph entities and edges
  are extracted and upserted. Superseded facts are auto-invalidated
  (cosine similarity >= 0.92). Does not require the agent to
  structure the input — unstructured prose is fine. ([validated by `episode.test.ts:52`](mcp-server/src/routes/episode.test.ts#L52), [`facts.test.ts:174`](mcp-server/src/facts.test.ts#L174), [`graph.test.ts:42`](mcp-server/src/graph.test.ts#L42))

### Knowledge Graph

- **`lore_query_graph(entity?, relation?, repo?, limit?)`** — queries the
  live knowledge graph for entities and their relationships. Entities
  carry temporal validity (`valid_from`/`valid_to`). Returns matching
  entities with their edge relationships.

### Monitoring

- **`lore_agent_stats(agent_id?)`** — returns memory count, total facts
  extracted, search count, episode count, and daily breakdown of
  activity. Primary health and usage tool. (Snapshot count and shared
  pool count are always 0 — those MCP tools were not shipped; see
  [Divergences from Original Design](#divergences-from-original-design).)

## Agent ID Resolution

Agent ID is resolved in this priority order:

1. Explicit `agent_id` parameter on any tool call. ([validated by `agent-id.test.ts:32`](shared/src/agent-id.test.ts#L32))
2. `LORE_AGENT_ID` environment variable. ([validated by `agent-id.test.ts:40`](shared/src/agent-id.test.ts#L40))
3. `~/.lore/agent-id` file (stable per machine across sessions). ([validated by `agent-id.test.ts:48`](shared/src/agent-id.test.ts#L48))
4. Auto-generated UUID (written to `~/.lore/agent-id` for future use). ([validated by `agent-id.test.ts:55`](shared/src/agent-id.test.ts#L55))

Lore Agent pods use their pod name. This ensures memories written by
cluster agents are attributable to a specific pod even after restart.

## Data Model

All tables live in the `memory` schema in the existing Lore PostgreSQL
database.

### memories

| Field        | Type           | Notes                                     |
|--------------|----------------|-------------------------------------------|
| id           | UUID           | PK                                        |
| agent_id     | TEXT           | Indexed                                   |
| key          | TEXT           | Unique per agent+key+version              |
| value        | TEXT           |                                           |
| embedding    | VECTOR(768)    | Populated async; HNSW indexed             |
| version      | INTEGER        | Monotonic per agent+key                   |
| is_deleted   | BOOLEAN        | Soft-delete                               |
| pool         | TEXT           | NULL = private; pool name = shared        |
| ttl_seconds  | INTEGER        | NULL = permanent                          |
| expires_at   | TIMESTAMPTZ    | Computed from ttl_seconds on write        |
| created_at   | TIMESTAMPTZ    |                                           |
| metadata     | JSONB          |                                           |

### memory_versions

Mirrors each write to `memories` preserving full history. Version
history is queryable via `lore_read_memory(key, version="all")`.

### facts

| Field            | Type        | Notes                                      |
|------------------|-------------|--------------------------------------------|
| id               | UUID        | PK                                         |
| memory_id        | UUID        | FK → memories (nullable; episode facts use episode_id) |
| fact_text        | TEXT        |                                            |
| embedding        | VECTOR(768) | HNSW indexed                               |
| confidence       | TEXT        | verified / observed / inferred / stale     |
| valid_from       | TIMESTAMPTZ | When this fact became valid                |
| valid_to         | TIMESTAMPTZ | NULL if still valid                        |
| invalidated_by   | UUID        | FK → facts (the fact that superseded this) |
| retrieval_count  | INTEGER     | Incremented on every search hit            |
| last_retrieved_at| TIMESTAMPTZ |                                            |
| half_life_days   | FLOAT       | Decay rate; extended on retrieval          |
| created_at       | TIMESTAMPTZ |                                            |

**Contradiction detection:** When new facts are extracted, each is
compared against existing valid facts by cosine similarity. If
similarity >= 0.92, the old fact's `valid_to` is set and
`invalidated_by` is linked. A record is inserted into `fact_conflicts`
before invalidation so context assembly can surface disputed knowledge
with a `[CONFLICT]` prefix.

**Confidence lifecycle:**
- `observed` — default for episode-sourced facts.
- `inferred` — for memory-sourced extractions.
- `verified` — human-confirmed (set manually).
- `stale` — automatically applied after 30 days of zero retrieval.
  Stale facts revive to `observed` on next retrieval.

### episodes

Raw text blobs ingested via `lore_write_episode`. Source of truth for
passive knowledge capture. Fact and graph extraction runs
asynchronously after write.

### entities + edges

Live knowledge graph. Entities represent services, teams,
technologies, and other named concepts. Edges represent typed
relationships (e.g., `depends_on`, `owns`, `uses`). Both carry
temporal validity. Contradictory edges (same source + relation + target
type, different target) auto-invalidate the prior edge.

### snapshots

Reference-based snapshots capturing memory IDs + version numbers at
a point in time. Internal implementation detail — not exposed as
MCP tools. Created manually via internal functions only.

### shared_pools

Named memory spaces. Shared pool functions (`sharedWrite`,
`sharedRead`) exist in the implementation but are not exposed as MCP
tools. Memories can be assigned to a pool via the `pool` field on
`lore_write_memory`, and `lore_search_memory` accepts a `pool` parameter for
scoped search.

### audit_log

Immutable record of all operations (write, read, search, delete)
with timestamp and agent ID.

## Fact Extraction

Triggered by `extract_facts=true` on `lore_write_memory`, or automatically
on all `lore_write_episode` calls.

Extraction is asynchronous and non-blocking. If the LLM is unreachable,
the memory write succeeds immediately and the memory is searchable as
raw text. Extraction is not retried automatically — failed extractions
are dropped.

The extraction LLM is configurable via `LORE_FACT_LLM`:
- `claude` — Anthropic API (default)
- `openai` — OpenAI API
- `ollama` — local Ollama instance

Haiku is used for extraction by default to minimize cost on high-frequency
writes. Each extracted fact gets an independent embedding for
fine-grained search.

## Memory Lifecycle (Background Jobs)

Two daily jobs run in the Lore Agent service to manage memory health:

### Importance Decay (5:00 AM UTC)

Scores all memories 0–10 using:

```
effective_age_days = now() - (last_retrieved_at ?? created_at)
strength = 0.5 ^ (effective_age_days / half_life_days)
```

Age is measured from `last_retrieved_at` when available, falling back
to `created_at`. This means retrieval resets the decay clock.

Additional factors:
- Retrieval count and `last_retrieved_at` boost scores.
- Confidence tier affects baseline: `stale` facts get -1 penalty.
- Content signals: decisions/conventions +2, auto-curation/sessions -1.

When an agent exceeds 500 memories, lowest-scoring are soft-deleted
(eviction). Invalidated facts beyond a cap of 2000 are hard-deleted
if older than 30 days.

Facts unretrieved for 30+ days are transitioned to `stale` confidence.

### Automatic Consolidation (5:30 AM UTC)

Groups recent facts (7-day lookback) by repo. Calls Haiku to extract
1–3 higher-level patterns per repo. Stored as
`consolidated/{repo}/{timestamp}` memories. Requires a minimum of 5
facts to trigger. Turns noisy raw facts into actionable insights.

## Passive Memory Capture (Session Layer)

The MCP server tracks all tool calls in memory (`session-tracker.ts`,
500-entry ring buffer). On session exit, dumps to
`~/.lore/last-session.json`. A stop hook POSTs to `/api/session-summary`
for automatic episode + fact extraction. No agent cooperation needed.

After every task completion (PR created, no-changes, failure), an
episode is automatically written via `episode-writer.ts`. For
high-signal events, Haiku extracts a "lesson learned" stored as a
`auto-curation/{ref}` memory.

## TTL and Expiration

Any memory can be written with a TTL (seconds). `expires_at` is
computed on write and stored. Expired memories are excluded from
reads and search via `expires_at > now()` checks. A background
cleanup job removes expired memories periodically. Permanent memories
(no TTL) are never auto-deleted.

## File-Backed Fallback

When PostgreSQL is unavailable, the key-value memory operations
(`write`/`read`/`search`/`delete`/`list`) fall back to `~/.lore/memory/`
on disk (implemented in `memory-file.ts`). Search quality degrades (no
vector similarity) but reads and writes continue. The fallback is
transparent to callers.

Tools without a file representation proxy to the GKE server over
`LORE_API_URL` instead: `lore_write_episode` (`POST /api/episode`) and
`lore_query_graph` (`GET /api/graph`, added so the live knowledge graph is
readable without a direct DB). `lore_agent_stats` has neither a file fallback
nor a proxy and returns a "requires PostgreSQL" message in local mode.

## Transfer Scoring (Cross-Repo Context)

Facts retrieved for cross-repo context are filtered by a portability
score. Portable keywords (`error`, `pattern`, `gotcha`, `convention`)
boost the score; local keywords (`config`, `deploy`, `url`, `auth`,
`secret`) reduce it. Only facts scoring >= 0.5 pass through to
prevent repo-specific configuration from polluting other repos.

## Divergences from Original Design

The following features were specified but not exposed as MCP tools:

| Specified Tool        | Status | Notes |
|-----------------------|--------|-------|
| `shared_write`        | Not exposed | Functions exist in memory.ts; pool field on lore_write_memory is the workaround |
| `shared_read`         | Not exposed | Functions exist in memory.ts; lore_search_memory with pool= is the workaround |
| `create_snapshot`     | Not exposed | Internal function exists; not registered as MCP tool |
| `restore_snapshot`    | Not exposed | Internal function exists; not registered as MCP tool |
| `agent_health`        | Not exposed | Data subsumed by lore_agent_stats |

The following capabilities were added beyond the original spec:

| Addition                          | Shipped in |
|-----------------------------------|------------|
| `lore_write_episode` tool              | 2-agent-memory |
| `lore_query_graph` tool                | live-knowledge-graph |
| Knowledge graph (entities + edges)| live-knowledge-graph |
| Fact contradiction detection      | 2-agent-memory |
| Confidence tiers (verified/observed/inferred/stale) | 2-agent-memory |
| Retrieval strengthening           | ADR-014 |
| Importance-based memory decay     | ADR-014 |
| Automatic fact consolidation      | ADR-014 |
| Session diversification in search | ADR-014 |
| File-backed fallback              | 2-agent-memory |
| Transfer scoring for cross-repo   | graph-augmented-search |
| Passive session capture           | ADR-014 |
| Post-task auto-curation           | ADR-014 |

## Non-Functional Requirements

### Performance

- Write latency under 50ms for single memory operations.
- Search latency under 100ms for 10,000+ memories.

### Scalability

- Up to 100 concurrent agents.
- Up to 100,000 memories per agent.
- Agent-level eviction (500-memory cap) prevents unbounded growth.

### Reliability

- PostgreSQL WAL ensures zero data loss on agent crash or pod
  preemption — every committed write is durable before the response
  returns.
- When PostgreSQL is unavailable, the file-backed fallback
  (`~/.lore/memory/`) keeps reads and writes available with degraded
  search quality (no vector similarity). Recovery to full search
  quality is automatic when the database reconnects.

### Security

- Agent memories are isolated by default (agent A cannot read
  agent B's private memories without explicit pool sharing).
- All memory writes pass through `sanitizeContent()` / `redactSecrets()`
  to strip API keys, JWTs, private keys, connection strings, and
  bearer tokens before storage. ([validated by `redact.test.ts:5`](shared/src/redact.test.ts#L5), [`episode-writer.test.ts:21`](agent/src/lib/episode-writer.test.ts#L21))
- Audit trail is immutable.

## Success Criteria (As Shipped)

1. An agent writes a memory in one session and retrieves it by
   semantic search in a later session, without any manual loading.
2. A Lore agent remembers what gap detection candidates it tried
   last week and avoids repeating them.
3. Two agents share findings through a named pool (via `pool=` on
   `lore_write_memory` and `lore_search_memory`).
4. `lore_write_episode` turns raw conversation text into searchable facts
   and knowledge graph updates without agent-side structuring.
5. A platform engineer can inspect any agent's memories and search
   across all agents via `lore_search_memory` with no `agent_id` filter.
6. The system handles 100 concurrent agents with memories bounded by
   the importance-decay eviction policy.

## Clarifications

### Session 2026-03-29

- Q: What happens on concurrent writes to the same memory key? → A: Last-write-wins. Both writes succeed, both create versions, latest timestamp wins for default read. No data lost.
- Q: What happens when fact extraction LLM is unreachable? → A: Write succeeds immediately. Fact extraction is dropped (not retried). Memory searchable as raw text.
- Q: How is agent identity established for Claude Code sessions? → A: Random UUID generated on first use, stored in ~/.lore/agent-id. Stable per machine. Lore Agent pods use pod name. Overridable via explicit agent_id parameter.
- Q: How are snapshots stored at scale? → A: Reference-based. Snapshot stores memory IDs + version numbers, not full copies. Restore sets version pointers. No data duplication. (Note: snapshot MCP tools not shipped — internal only.)
- Q: Should memory operations emit OTEL spans? → A: No. lore_agent_stats provides visibility into memory activity. Web UI for browsing memories is not yet implemented.

## Dependencies

- Existing PostgreSQL + pgvector instance (CNPG on GKE).
- Existing Lore MCP server (extends with new tools).
- Vertex AI text-embedding-005 for memory embeddings.
- Configurable LLM for fact extraction (`LORE_FACT_LLM`): Claude (default), OpenAI, or Ollama.
