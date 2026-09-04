# Feature Specification: Agent Runtime Memory

| Field          | Value                                       |
|----------------|---------------------------------------------|
| Feature        | Agent Runtime Memory                        |
| Branch         | 2-agent-memory                              |
| Status         | Shipped                                     |
| Created        | 2026-03-29                                  |
| Updated        | 2026-04-20 (post-ship drift correction)     |
| Owner          | Platform Engineering                        |

Agent Runtime Memory gives every agent — local Claude Code, Lore cluster workers, and future integrations — persistent, versioned, semantically searchable memory backed by Lore's existing PostgreSQL and pgvector infrastructure, so sessions and scheduled agents no longer start cold every time.

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

**Developer (Claude Code user)**

Works in Claude Code daily. Wants Claude to remember preferences,
past decisions, and context from previous sessions without repeating
themselves. Expects it to work automatically — no manual save/load.

**Lore Agent (cluster worker)**

Runs background tasks (ingestion, gap detection, spec drift). Needs
to remember what it did in previous runs: what gaps it already
drafted, what specs it already checked, what candidates it tried
and their scores. Without memory, it repeats work or misses patterns
that span multiple runs.

**Platform Engineer (operator)**

Manages the Lore infrastructure. Needs to see what agents remember,
debug unexpected agent behavior by inspecting memories, and understand
the current state of the agent knowledge graph.

## Shipped MCP Tools

Decision: these are the tools actually registered in the MCP server and
available to agents — the authoritative interface.

### Memory CRUD

- **`lore_write_memory(key, value, agent_id?, ttl?, extract_facts?)`** —
  creates or updates a memory. Every write to an existing key creates
  a new version (monotonic). Returns the memory with version number.
  If `extract_facts=true`, fact extraction runs asynchronously and
  does not block the response. An upsert overwrites the value on a
  `(agent, key, version=1)` collision; an append bumps the version and
  concatenates on an `(agent, key)` collision. ([validated by `memory.test.ts:33`](libs/shared/src/project/memory/memory.test.ts#L33), [`memory-store-bridge.test.ts:40`](libs/shared/src/project/memory/memory-store-bridge.test.ts#L40), [`memory-lifecycle.test.ts:124`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L124), [`memory-lifecycle.test.ts:375`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L375), [`memory-lifecycle.test.ts:139`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L139), [`memory-lifecycle.test.ts:385`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L385), [`memory.test.ts:110`](libs/server-core/src/features/memory/memory.test.ts#L110))

- `writeMemory` (the `lore_write_memory` path) writes the memories row and its
  version row atomically: when the pool provides a client (`connect()`), the
  write runs inside one transaction, so a
  failed version insert rolls the memories insert back instead of leaving a
  version-less memory behind (#1154). ([validated by `memory.test.ts:460`](libs/server-core/src/features/memory/memory.test.ts#L460), [`memory.test.ts:489`](libs/server-core/src/features/memory/memory.test.ts#L489), [`memory.test.ts:508`](libs/server-core/src/features/memory/memory.test.ts#L508))

- `sharedWrite` (pool-scoped writes) carries the same atomicity contract: the
  shared-pool lookup/create, the memories insert, and the version insert all
  run on one client between `BEGIN` and `COMMIT` when the pool provides
  `connect()`, a failed version insert rolls the whole write back, and a
  query-only pool keeps the sequential path (#1158). ([validated by `memory.test.ts:610`](libs/server-core/src/features/memory/memory.test.ts#L610), [`memory.test.ts:648`](libs/server-core/src/features/memory/memory.test.ts#L648), [`memory.test.ts:671`](libs/server-core/src/features/memory/memory.test.ts#L671))

- `PostgresMemoryStore.writeMemory` (the `MemoryStore` seam's Postgres backend)
  applies the same transaction around its memories write and version insert,
  for both the fresh-insert and version-bump branches, falling back to
  sequential writes on a query-only pool (#1158). ([validated by `postgres-memory-store.test.ts:278`](libs/shared/src/postgres-memory-store.test.ts#L278), [`postgres-memory-store.test.ts:306`](libs/shared/src/postgres-memory-store.test.ts#L306), [`postgres-memory-store.test.ts:330`](libs/shared/src/postgres-memory-store.test.ts#L330), [`postgres-memory-store.test.ts:356`](libs/shared/src/postgres-memory-store.test.ts#L356))

- Memory writers bind `ttl` as a `make_interval(secs => $n)` query parameter
  instead of interpolating it into the SQL text, binding NULL when no ttl is
  given (#1158). ([validated by `memory.test.ts:705`](libs/server-core/src/features/memory/memory.test.ts#L705), [`memory.test.ts:744`](libs/server-core/src/features/memory/memory.test.ts#L744), [`memory.test.ts:781`](libs/server-core/src/features/memory/memory.test.ts#L781), [`postgres-memory-store.test.ts:390`](libs/shared/src/postgres-memory-store.test.ts#L390), [`postgres-memory-store.test.ts:428`](libs/shared/src/postgres-memory-store.test.ts#L428), [`postgres-memory-store.test.ts:464`](libs/shared/src/postgres-memory-store.test.ts#L464))

- **`lore_read_memory(key, agent_id?, version?)`** — returns the latest
  version by default. Pass `version="all"` for full version history, or a
  specific version number to read that one version. ([validated by `memory.test.ts:150`](libs/server-core/src/features/memory/memory.test.ts#L150), [`memory.test.ts:177`](libs/server-core/src/features/memory/memory.test.ts#L177), [`memory.test.ts:208`](libs/server-core/src/features/memory/memory.test.ts#L208))

- **`lore_delete_memory(key, agent_id?)`** — soft-deletes (sets `is_deleted`,
  preserved in history but excluded from search). ([validated by `memory.test.ts:242`](libs/server-core/src/features/memory/memory.test.ts#L242))

- **`lore_list_memories(agent_id?, limit?, offset?)`** — paginated listing
  of active (non-deleted, non-expired) memories for an agent. ([validated by `memory.test.ts:272`](libs/server-core/src/features/memory/memory.test.ts#L272), [`memory.test.ts:219`](apps/lore-api/src/api/routes/memory/memory.test.ts#L219))

### Semantic Search

- **`lore_search_memory(query, agent_id?, limit?, pool?, include_invalidated?,
  graph_augment?)`** — hybrid semantic + keyword search over memories
  and extracted facts using Reciprocal Rank Fusion. Results include
  confidence annotations and similarity scores. ([validated by `memory-ranking.test.ts:11`](libs/shared/src/memory-ranking.test.ts#L11))
  - `include_invalidated=true` enables historical queries (facts
    superseded by later contradictions are included). ([validated by `memory-search.test.ts:41`](libs/shared/src/project/knowledge/memory-search.test.ts#L32), [`memory-search.test.ts:43`](libs/shared/src/project/knowledge/memory-search.test.ts#L43))
  - `graph_augment=true` enriches results with related graph entities. ([validated by `memory-search.test.ts:63`](libs/shared/src/project/knowledge/memory-search.test.ts#L54), [`memory-search.test.ts:96`](libs/shared/src/project/knowledge/memory-search.test.ts#L96))
  - Results are capped at 3 per (agent_id + source) combo to prevent
    verbose sessions from dominating (session diversification); sources already under the cap are returned intact. ([validated by `memory-ranking.test.ts:53`](libs/shared/src/memory-ranking.test.ts#L53), [validated by `keeps all items when each source is under the cap`](libs/shared/src/memory-ranking.test.ts#L99))
  - Every search call asynchronously increments `retrieval_count`,
    updates `last_retrieved_at`, and extends `half_life_days` (+2,
    cap 365) on returned facts and memories. ([validated by `memory-search.test.ts:128`](libs/shared/src/project/knowledge/memory-search.test.ts#L119))

### Episode Ingestion

- **`lore_write_episode(text, agent_id?, repo?, source?)`** — ingests raw
  text (conversation turns, code reviews, observations). Fact
  extraction runs asynchronously. Knowledge graph entities and edges
  are extracted and upserted. Superseded facts are auto-invalidated
  (cosine similarity >= 0.92). Does not require the agent to
  structure the input — unstructured prose is fine. ([validated by `episode.test.ts:84`](apps/lore-api/src/api/routes/memory/episode.test.ts#L84), [`facts.test.ts:5`](libs/server-core/src/features/memory/facts.test.ts#L5), [`graph.test.ts:5`](libs/server-core/src/features/memory/graph.test.ts#L5))

### Knowledge Graph

- **`lore_query_graph(entity?, relation?, repo?, limit?)`** — queries the
  live knowledge graph for entities and their relationships. Entities
  carry temporal validity (`valid_from`/`valid_to`). Returns matching
  entities with their edge relationships. ([validated by `graph.test.ts:31`](apps/lore-api/src/api/routes/graph/graph.test.ts#L31), [`graph.test.ts:55`](apps/lore-api/src/api/routes/graph/graph.test.ts#L55), [`memory-tools.test.ts:50`](apps/mcp-server/src/mcp/tools/memory-tools.test.ts#L50))

### Monitoring

- **`lore_agent_stats(agent_id?)`** — returns memory count, total facts
  extracted, search count, and episode count. Primary health and usage
  tool. (Snapshot count and shared pool count are always 0 — those MCP
  tools were not shipped; see
  [Divergences from Original Design](#divergences-from-original-design).) ([validated by `memory.test.ts:377`](libs/server-core/src/features/memory/memory.test.ts#L377))

## Agent ID Resolution

Agent ID is resolved in this priority order: ([validated by `agent-id.test.ts:44`](libs/shared/src/agent-id.test.ts#L44))

1. Explicit `agent_id` parameter on any tool call. ([validated by `agent-id.test.ts:44`](libs/shared/src/agent-id.test.ts#L44))

2. `LORE_AGENT_ID` environment variable. ([validated by `agent-id.test.ts:53`](libs/shared/src/agent-id.test.ts#L53))

3. `~/.lore/agent-id` file (stable per machine across sessions). ([validated by `agent-id.test.ts:62`](libs/shared/src/agent-id.test.ts#L62))

4. Auto-generated UUID (written to `~/.lore/agent-id` for future use). ([validated by `agent-id.test.ts:70`](libs/shared/src/agent-id.test.ts#L70))

Lore Agent pods use their pod name (passed as `LORE_AGENT_ID`), so memories
written by cluster agents stay attributable to a specific pod even after
restart. ([validated by `agent-id.test.ts:53`](libs/shared/src/agent-id.test.ts#L53))

## Data Model

Decision: all tables live in the `memory` schema in the existing Lore
PostgreSQL database.

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

Mirrors each write to `memories`, preserving full history queryable via
`lore_read_memory(key, version="all")`. ([validated by `memory.test.ts:177`](libs/server-core/src/features/memory/memory.test.ts#L177))

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

#### Contradiction detection

- When new facts are extracted, each is compared against existing valid facts
  by cosine similarity; at or above a `0.92` threshold the old fact's
  `valid_to` is set, `invalidated_by` is linked, and a row is written to
  `fact_conflicts` before invalidation so context assembly can surface disputed
  knowledge with a `[CONFLICT]` prefix. ([validated by `facts-extraction.test.ts:42`](libs/server-core/src/features/memory/facts-extraction.test.ts#L42))

#### Invalidated-fact eviction

- Eviction of old invalidated facts is **scoped to one agent**. The decay job
  counts invalidated facts per agent and calls the delete once per agent that is
  over the cap, passing that agent's excess — so the delete must filter by agent
  in SQL and not only by `LIMIT`. A table-wide delete answering a per-agent quota
  takes the oldest facts anywhere, which means one agent's quota can be filled
  entirely from another agent's rows and an agent **under** the cap can lose
  facts it should have kept. It filters THROUGH THE SOURCE: `memory.facts` has no
  `agent_id` column, and a fact belongs to whichever agent owns the memory or
  episode it was extracted from — the same join the per-agent count already
  groups by. Naming a bare `agent_id` on the facts table reads correctly and
  raises `42703` against the real schema, which a fake pool that answers every
  statement will not catch. ([validated by `memory-lifecycle.test.ts:550`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L550), [`memory-lifecycle.test.ts:561`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L561), [`memory-lifecycle.test.ts:572`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L572), [`memory-lifecycle.test.ts:591`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L591))

#### Confidence lifecycle

- `observed` — default for episode-sourced facts. ([validated by `facts-extraction.test.ts:142`](libs/server-core/src/features/memory/facts-extraction.test.ts#L142))
- `inferred` — for memory-sourced extractions. ([validated by `facts-extraction.test.ts:111`](libs/server-core/src/features/memory/facts-extraction.test.ts#L111))
- Decision: `verified` is the human-confirmed tier, set manually (no automated code path).
- `stale` — automatically applied after 30 days of zero retrieval.
  Stale facts revive to `observed` on next retrieval. ([validated by `memory-lifecycle.test.ts:188`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L188), [`memory-search.test.ts:119`](libs/shared/src/project/knowledge/memory-search.test.ts#L119))

### episodes

Raw text blobs ingested via `lore_write_episode` are the source of truth for
passive knowledge capture; fact and graph extraction runs asynchronously
after write. ([validated by `episode.test.ts:84`](apps/lore-api/src/api/routes/memory/episode.test.ts#L84))

Episode inserts are idempotent — deduplicated on `(agent_id, content_hash)`,
returning the new id or null when a duplicate already exists. ([validated by `memory-lifecycle.test.ts:271`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L271), [`memory-lifecycle.test.ts:289`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L289), [`memory-lifecycle.test.ts:518`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L518))

### entities + edges

Live knowledge graph: entities represent services, teams, technologies, and
other named concepts; edges represent typed relationships (e.g., `depends_on`,
`owns`, `uses`), both carry temporal validity, and contradictory edges (same
source + relation, different target) auto-invalidate the prior edge. ([validated by `graph.test.ts:47`](libs/server-core/src/features/memory/graph.test.ts#L5), [`graph-edge.test.ts:40`](libs/server-core/src/features/memory/graph-edge.test.ts#L40), [`graph-edge.test.ts:86`](libs/server-core/src/features/memory/graph-edge.test.ts#L86))

### snapshots

Decision: reference-based snapshots capture memory IDs + version numbers at a
point in time — an internal implementation detail, not exposed as MCP tools,
created only via internal functions.

### shared_pools

Decision: named memory spaces — the `sharedWrite`/`sharedRead` pool functions
exist in the implementation but are not exposed as MCP tools; the shipped
surface is the `pool` field on `lore_write_memory` and the `pool` parameter on
`lore_search_memory` for scoped search.

### audit_log

Immutable record of all operations (write, read, search, delete)
with timestamp and agent ID. ([validated by `memory.test.ts:258`](libs/server-core/src/features/memory/memory.test.ts#L258))

## Fact Extraction

Triggered by `extract_facts=true` on `lore_write_memory`, or automatically
on all `lore_write_episode` calls. ([validated by `episode.test.ts:84`](apps/lore-api/src/api/routes/memory/episode.test.ts#L84))

Extraction is asynchronous and non-blocking: if the LLM is unreachable the
memory write succeeds immediately and the memory stays searchable as raw text,
and a failed extraction (after its internal retries) is dropped rather than
blocking or being re-queued. ([validated by `facts-extraction.test.ts:90`](libs/server-core/src/features/memory/facts-extraction.test.ts#L90))

The extraction LLM is configurable via `LORE_FACT_LLM` — `claude` (Anthropic,
the default), `openai`, or `ollama` (local). ([validated by `select-provider.test.ts:29`](libs/shared/src/llm/select-provider.test.ts#L29), [`select-provider.test.ts:17`](libs/shared/src/llm/select-provider.test.ts#L17), [`select-provider.test.ts:23`](libs/shared/src/llm/select-provider.test.ts#L23))

Haiku is the default extraction model (minimizing cost on high-frequency
writes), falling back to the Claude CLI when no `ANTHROPIC_API_KEY` is present;
each extracted fact gets an independent embedding for fine-grained search. ([validated by `select-provider.test.ts:13`](libs/shared/src/llm/select-provider.test.ts#L13), [`select-provider.test.ts:29`](libs/shared/src/llm/select-provider.test.ts#L29))

The LLM's raw output is parsed into individual facts: a JSON array
(unwrapping ```` ```json ```` code fences), falling back to newline /
numbered-list splitting for non-JSON, with empty strings filtered out
and a cap of 10 facts. ([validated by `facts.test.ts:39`](libs/server-core/src/features/memory/facts.test.ts#L14), [`facts.test.ts:20`](libs/server-core/src/features/memory/facts.test.ts#L20), [`facts.test.ts:26`](libs/server-core/src/features/memory/facts.test.ts#L26), [`facts.test.ts:40`](libs/server-core/src/features/memory/facts.test.ts#L40))

Each parsed fact is stored independently: a fact whose insert fails is
skipped without aborting the rest of the batch, and a fact whose embedding
could not be computed is still inserted (with a null embedding) but never
reaches the contradiction check, which needs a vector to compare against.
([validated by `facts-extraction.test.ts:170`](libs/server-core/src/features/memory/facts-extraction.test.ts#L170), [`facts-extraction.test.ts:204`](libs/server-core/src/features/memory/facts-extraction.test.ts#L204))

## Memory Lifecycle (Background Jobs)

Two daily jobs run in the Lore Agent service to manage memory health:

### Importance Decay (5:00 AM UTC)

Scores all memories 0–10 using: ([validated by `memory-ranking.test.ts:113`](libs/shared/src/memory-ranking.test.ts#L113))

```
effective_age_days = now() - (last_retrieved_at ?? created_at)
strength = 0.5 ^ (effective_age_days / half_life_days)
```

Age is measured from `last_retrieved_at` when available, falling back to
`created_at`, so retrieval resets the decay clock. ([validated by `memory-ranking.test.ts:168`](libs/shared/src/memory-ranking.test.ts#L168))

Additional factors: ([validated by `memory-ranking.test.ts:113`](libs/shared/src/memory-ranking.test.ts#L113))
- Retrieval count and `last_retrieved_at` boost scores. ([validated by `memory-ranking.test.ts:168`](libs/shared/src/memory-ranking.test.ts#L168), [`memory-ranking.test.ts:113`](libs/shared/src/memory-ranking.test.ts#L113))
- Confidence tier affects baseline: `stale` facts get -1 penalty. ([validated by `memory-ranking.test.ts:162`](libs/shared/src/memory-ranking.test.ts#L162))
- Content signals: decisions/conventions/gotchas/patterns +2,
  auto-curation/sessions -1, and content richness (short `<50` chars
  -2, long `>500` chars +1). ([validated by `memory-ranking.test.ts:156`](libs/shared/src/memory-ranking.test.ts#L156), [`memory-ranking.test.ts:147`](libs/shared/src/memory-ranking.test.ts#L147), [validated by `adds 2 for a key containing gotcha`](libs/shared/src/memory-ranking.test.ts#L156), [validated by `subtracts 2 for a value shorter than 50 chars`](libs/shared/src/memory-ranking.test.ts#L147))
- The final score is clamped to the `[0, 10]` range. ([validated by `memory-ranking.test.ts:180`](libs/shared/src/memory-ranking.test.ts#L180), [`memory-ranking.test.ts:222`](libs/shared/src/memory-ranking.test.ts#L222), [validated by `clamps to 0 when decay and penalties push below zero`](libs/shared/src/memory-ranking.test.ts#L180))

When an agent exceeds 500 memories, memories are scored, sorted
least-important-first, and the lowest-scoring are soft-deleted
(eviction). ([validated by `memory-ranking.test.ts:233`](libs/shared/src/memory-ranking.test.ts#L233), [`memory-lifecycle.test.ts:63`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L63), [`memory-lifecycle.test.ts:305`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L305), [`memory-lifecycle.test.ts:77`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L77), [`memory-lifecycle.test.ts:320`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L320), [`memory-lifecycle.test.ts:87`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L87), [`memory-lifecycle.test.ts:334`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L334))

Invalidated facts beyond a cap of 2000 are hard-deleted
if older than 30 days. ([validated by `memory-lifecycle.test.ts:161`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L161), [`memory-lifecycle.test.ts:397`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L397), [`memory-lifecycle.test.ts:174`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L174), [`memory-lifecycle.test.ts:412`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L412))

Facts unretrieved for 30+ days are transitioned to `stale` confidence. ([validated by `memory-lifecycle.test.ts:188`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L188))

### Automatic Consolidation (5:30 AM UTC)

Groups recent valid facts (7-day lookback, newest-first) by repo. ([validated by `memory-lifecycle.test.ts:198`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L198), [`memory-lifecycle.test.ts:451`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L451))

Haiku extracts 1–3 higher-level patterns per repo (a minimum of 5 facts is
required to trigger), stored as `consolidated/{repo}/{timestamp}` memories —
turning noisy raw facts into actionable insights. ([validated by `memory-lifecycle.test.ts:17`](apps/floor/src/jobs/memory/memory-lifecycle/memory-lifecycle.test.ts#L5), [`memory-lifecycle.test.ts:99`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L99))

Only `PATTERN:`-prefixed lines from the LLM response are kept (short
patterns filtered out; a `NONE` response yields no patterns), and each
consolidated memory is inserted once, deduped on its key. ([validated by `memory-lifecycle.test.ts:17`](apps/floor/src/jobs/memory/memory-lifecycle/memory-lifecycle.test.ts#L5), [`memory-lifecycle.test.ts:19`](apps/floor/src/jobs/memory/memory-lifecycle/memory-lifecycle.test.ts#L19), [`memory-lifecycle.test.ts:23`](apps/floor/src/jobs/memory/memory-lifecycle/memory-lifecycle.test.ts#L23), [`memory-lifecycle.test.ts:99`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L99), [`memory-lifecycle.test.ts:345`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L345))

## Passive Memory Capture (Session Layer)

The MCP server tracks all tool calls in a 500-entry ring buffer
(`session-tracker.ts`), dumping to `~/.lore/last-session.json` on session exit;
a stop hook POSTs to `/api/session-summary` for automatic episode + fact
extraction, with no agent cooperation needed. ([validated by `session-dump.test.ts:31`](libs/server-core/src/platform/session-dump.test.ts#L25), [`session-dump.test.ts:50`](libs/server-core/src/platform/session-dump.test.ts#L50), [`session-summary.test.ts:71`](apps/lore-api/src/api/routes/memory/session-summary.test.ts#L71))

After every task completion (PR created, no-changes, failure), an episode is
automatically written via `episode-writer.ts`, and for high-signal events Haiku
extracts a "lesson learned" stored as an `auto-curation/{ref}` memory. ([validated by `episode-writer.test.ts:89`](libs/shared/src/episode-writer.test.ts#L89))

## TTL and Expiration

Any memory can be written with a TTL (seconds); `expires_at` is computed on
write, expired memories are excluded from reads and search via
`expires_at > now()`, and a background cleanup job soft-deletes only memories
whose `expires_at` has passed (reporting how many) while permanent memories
(no TTL) are never auto-deleted. ([validated by `memory-lifecycle.test.ts:114`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L114), [`memory-lifecycle.test.ts:358`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L358))

## File-Backed Fallback

When PostgreSQL is unavailable, the key-value memory operations
(`write`/`read`/`search`/`delete`/`list`) fall back transparently to
`~/.lore/memory/` on disk (`memory-file.ts`) — reads and writes continue with
degraded search (no vector similarity); availability is decided by whether a
Postgres pool has been configured via `setMemoryPool`. ([validated by `memory.test.ts:38`](libs/server-core/src/features/memory/memory.test.ts#L38), [`memory.test.ts:43`](libs/server-core/src/features/memory/memory.test.ts#L43), [`memory-file.test.ts:33`](libs/server-core/src/features/memory/memory-file.test.ts#L33), [`memory-file.test.ts:46`](libs/server-core/src/features/memory/memory-file.test.ts#L46), [`memory-file.test.ts:60`](libs/server-core/src/features/memory/memory-file.test.ts#L60), [`memory-file.test.ts:87`](libs/server-core/src/features/memory/memory-file.test.ts#L87), [`memory-file.test.ts:101`](libs/server-core/src/features/memory/memory-file.test.ts#L101), [`memory-file.test.ts:120`](libs/server-core/src/features/memory/memory-file.test.ts#L120), [`memory-file.test.ts:129`](libs/server-core/src/features/memory/memory-file.test.ts#L129))

Tools without a file representation proxy to the GKE server over
`LORE_API_URL` instead: `lore_write_episode` (`POST /api/episode`) and
`lore_query_graph` (`GET /api/graph`, so the live knowledge graph is readable
without a direct DB); `lore_agent_stats` has neither a file fallback nor a
proxy and returns a "requires PostgreSQL" message in local mode. ([validated by `episode.test.ts:84`](apps/lore-api/src/api/routes/memory/episode.test.ts#L84), [`memory-tools.test.ts:50`](apps/mcp-server/src/mcp/tools/memory-tools.test.ts#L50), [`memory-tools.test.ts:72`](apps/mcp-server/src/mcp/tools/memory-tools.test.ts#L72))

## Transfer Scoring (Cross-Repo Context)

Facts retrieved for cross-repo context are filtered by a portability
score. Portable keywords (`error`, `pattern`, `gotcha`, `convention`)
boost the score; local keywords (`config`, `deploy`, `url`, `auth`,
`secret`) reduce it. Each portable keyword adds 0.15 above the 0.5 base and each local keyword subtracts 0.15, with the result clamped to `[0, 1]`. Only facts scoring >= 0.5 pass through to
prevent repo-specific configuration from polluting other repos. ([validated by `transfer-score.test.ts:66`](apps/mcp-server/src/features/context/transfer-score.test.ts#L27), [`memory-ranking.test.ts:33`](libs/shared/src/memory-ranking.test.ts#L33), [`memory-ranking.test.ts:37`](libs/shared/src/memory-ranking.test.ts#L37), [`memory-ranking.test.ts:41`](libs/shared/src/memory-ranking.test.ts#L41), [`memory-ranking.test.ts:47`](libs/shared/src/memory-ranking.test.ts#L47))

## Divergences from Original Design

Decision: the following features were specified but not exposed as MCP tools:

| Specified Tool        | Status | Notes |
|-----------------------|--------|-------|
| `shared_write`        | Not exposed | Functions exist in memory.ts; pool field on lore_write_memory is the workaround |
| `shared_read`         | Not exposed | Functions exist in memory.ts; lore_search_memory with pool= is the workaround |
| `create_snapshot`     | Not exposed | Internal function exists; not registered as MCP tool |
| `restore_snapshot`    | Not exposed | Internal function exists; not registered as MCP tool |
| `agent_health`        | Not exposed | Data subsumed by lore_agent_stats |

Decision: the following capabilities were added beyond the original spec:

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

### Reliability & Security

- When PostgreSQL is unavailable, the file-backed fallback
  (`~/.lore/memory/`) keeps reads and writes available with degraded search
  quality (no vector similarity), recovering to full search quality
  automatically when the database reconnects. ([validated by `memory.test.ts:38`](libs/server-core/src/features/memory/memory.test.ts#L38), [`memory.test.ts:43`](libs/server-core/src/features/memory/memory.test.ts#L43))
- Agent-level eviction (500-memory cap) prevents unbounded growth. ([validated by `memory-lifecycle.test.ts:63`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L63), [`memory-lifecycle.test.ts:87`](libs/shared/src/project/memory/memory-lifecycle.test.ts#L87))
- Agent/repo isolation by default: agent A cannot read agent B's private
  memories without explicit pool sharing, and a read bound to one repo never
  returns another repo's memory (listings filtered to the bound scope). ([validated by `memory.test.ts:51`](libs/shared/src/project/memory/memory.test.ts#L51), [`memory-store-bridge.test.ts:49`](libs/shared/src/project/memory/memory-store-bridge.test.ts#L49))
- All memory writes pass through `sanitizeContent()` / `redactSecrets()`
  to strip API keys, JWTs, private keys, connection strings, and
  bearer tokens before storage. ([validated by `redact.test.ts:5`](libs/shared/src/redact.test.ts#L5), [`episode-writer.test.ts:13`](libs/shared/src/episode-writer.test.ts#L13))
- Audit trail is immutable. ([validated by `memory.test.ts:258`](libs/server-core/src/features/memory/memory.test.ts#L258))

## Operational Targets (Background)

The performance targets and infrastructure guarantees below are operational
context, not unit-tested behaviour.

- Write latency under 50ms for single memory operations; search latency under
  100ms for 10,000+ memories.
- Up to 100 concurrent agents; up to 100,000 memories per agent.
- PostgreSQL WAL ensures zero data loss on agent crash or pod preemption —
  every committed write is durable before the response returns.

## Goals & Non-Goals (As Shipped)

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

**Session 2026-03-29**

- Q: What happens on concurrent writes to the same memory key? → A: Last-write-wins. Both writes succeed, both create versions, latest timestamp wins for default read. No data lost.
- Q: What happens when fact extraction LLM is unreachable? → A: Write succeeds immediately. Fact extraction is dropped (not retried). Memory searchable as raw text.
- Q: How is agent identity established for Claude Code sessions? → A: Random UUID generated on first use, stored in ~/.lore/agent-id. Stable per machine. Lore Agent pods use pod name. Overridable via explicit agent_id parameter.
- Q: How are snapshots stored at scale? → A: Reference-based. Snapshot stores memory IDs + version numbers, not full copies. Restore sets version pointers. No data duplication. (Note: snapshot MCP tools not shipped — internal only.)
- Q: Should memory operations emit OTEL spans? → A: No. lore_agent_stats provides visibility into memory activity. Web UI for browsing memories is not yet implemented.

## Background: Dependencies

- Existing PostgreSQL + pgvector instance (CNPG on GKE).
- Existing Lore MCP server (extends with new tools).
- Vertex AI text-embedding-005 for memory embeddings.
- Configurable LLM for fact extraction (`LORE_FACT_LLM`): Claude (default), OpenAI, or Ollama.
