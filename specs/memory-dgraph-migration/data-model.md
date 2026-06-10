# Data Model: Memory → Dgraph

The Postgres `memory` schema becomes a Dgraph type system. Every node
carries an `xid` predicate holding its original Postgres UUID
(`@index(hash) @upsert`) so the backfill is idempotent and external/MCP
ids never change. Temporal edges are **reified** as `GraphRel` nodes
(Dgraph facets are not indexable). An indexed `active` bool mirrors
`valid_to IS NULL` so `@recurse` traverses only the live subgraph and
"current graph" queries avoid a scan.

Query language is **DQL**. The driver is `dgraph-js` (gRPC) wrapped by
`shared/src/dgraph-client.ts`. All ranking/scoring stays in
`shared/src/memory-ranking.ts` and is backend-agnostic.

## Type system

```
type Memory       { Memory.xid Memory.agent_id Memory.key Memory.value
                    Memory.embedding Memory.version Memory.is_deleted Memory.pool
                    Memory.ttl_seconds Memory.expires_at Memory.repo
                    Memory.retrieval_count Memory.last_retrieved_at Memory.half_life_days
                    Memory.metadata Memory.created_at Memory.versions Memory.facts }
type MemoryVersion{ MemoryVersion.xid MemoryVersion.memory MemoryVersion.version
                    MemoryVersion.value MemoryVersion.embedding MemoryVersion.created_at }
type Fact         { Fact.xid Fact.text Fact.embedding Fact.valid_from Fact.valid_to
                    Fact.active Fact.invalidated_by Fact.confidence
                    Fact.retrieval_count Fact.last_retrieved_at Fact.half_life_days
                    Fact.memory Fact.episode Fact.agent_id Fact.created_at Fact.conflicts }
type FactConflict { FactConflict.xid FactConflict.old_fact FactConflict.new_fact
                    FactConflict.similarity FactConflict.created_at }
type Episode      { Episode.xid Episode.agent_id Episode.content Episode.content_hash
                    Episode.source Episode.ref Episode.embedding Episode.created_at }
type Entity       { Entity.xid Entity.name Entity.entity_type Entity.properties Entity.repo
                    Entity.dedup_key Entity.created_at Entity.updated_at
                    Entity.out_rels Entity.in_rels }
type GraphRel     { GraphRel.xid GraphRel.source GraphRel.target GraphRel.relation_type
                    GraphRel.properties GraphRel.valid_from GraphRel.valid_to GraphRel.active
                    GraphRel.source_episode GraphRel.source_memory GraphRel.created_at }
type SharedPool   { SharedPool.xid SharedPool.name SharedPool.created_by SharedPool.created_at }
type Snapshot     { Snapshot.xid Snapshot.agent_id Snapshot.memory_refs Snapshot.trigger Snapshot.created_at }
type AuditLog     { AuditLog.xid AuditLog.agent_id AuditLog.operation AuditLog.memory_key
                    AuditLog.metadata AuditLog.created_at }
```

## Predicate & index definitions

```dql
# Identity (idempotent backfill key on every type)
Memory.xid: string @index(hash) @upsert .
MemoryVersion.xid: string @index(hash) @upsert .
Fact.xid: string @index(hash) @upsert .
FactConflict.xid: string @index(hash) @upsert .
Episode.xid: string @index(hash) @upsert .
Entity.xid: string @index(hash) @upsert .
GraphRel.xid: string @index(hash) @upsert .
SharedPool.xid: string @index(hash) @upsert .
Snapshot.xid: string @index(hash) @upsert .
AuditLog.xid: string @index(hash) @upsert .

# Memory
Memory.agent_id:          string   @index(hash) .
Memory.key:               string   @index(hash, term) .
Memory.value:             string   @index(fulltext) .
Memory.embedding:         float32vector @index(hnsw(metric:"cosine")) .
Memory.version:           int .
Memory.is_deleted:        bool     @index(bool) .
Memory.pool:              uid      @reverse .
Memory.ttl_seconds:       int .
Memory.expires_at:        dateTime @index(hour) .
Memory.repo:              string   @index(hash) .
Memory.retrieval_count:   int .
Memory.last_retrieved_at: dateTime .
Memory.half_life_days:    int .
Memory.metadata:          string .
Memory.created_at:        dateTime @index(hour) .
Memory.versions:          [uid]    @reverse @count .
Memory.facts:             [uid]    @reverse @count .

# MemoryVersion
MemoryVersion.memory:     uid      @reverse .
MemoryVersion.version:    int      @index(int) .
MemoryVersion.value:      string .
MemoryVersion.embedding:  float32vector .
MemoryVersion.created_at: dateTime .

# Fact
Fact.text:               string   @index(fulltext) .
Fact.embedding:          float32vector @index(hnsw(metric:"cosine")) .
Fact.valid_from:         dateTime @index(hour) .
Fact.valid_to:           dateTime @index(hour) .
Fact.active:             bool     @index(bool) .
Fact.invalidated_by:     uid .
Fact.confidence:         string   @index(hash) .
Fact.retrieval_count:    int .
Fact.last_retrieved_at:  dateTime .
Fact.half_life_days:     int .
Fact.memory:             uid      @reverse .
Fact.episode:            uid      @reverse .
Fact.agent_id:           string   @index(hash) .   # denormalized (was COALESCE(m,e))
Fact.created_at:         dateTime @index(hour) .
Fact.conflicts:          [uid]    @reverse .

# FactConflict
FactConflict.old_fact:   uid      @reverse .
FactConflict.new_fact:   uid      @reverse .
FactConflict.similarity: float .
FactConflict.created_at: dateTime .

# Episode
Episode.agent_id:        string   @index(hash) .
Episode.content:         string   @index(fulltext) .
Episode.content_hash:    string   @index(hash) @upsert .   # SHA256 dedup
Episode.source:          string   @index(hash) .   # conversation|review|observation|session|adr|spec
Episode.ref:             string .                   # for adr|spec: the source file_path
Episode.embedding:       float32vector @index(hnsw(metric:"cosine")) .
Episode.created_at:      dateTime @index(hour) .

# Entity
Entity.name:             string   @index(hash, term) .
Entity.entity_type:      string   @index(hash) .
Entity.properties:       string .
Entity.repo:             string   @index(hash) .
Entity.dedup_key:        string   @index(hash) @upsert .   # name|type|repo
Entity.created_at:       dateTime .
Entity.updated_at:       dateTime @index(hour) .   # orderdesc for the graph UI "most recent entities" table
Entity.out_rels:         [uid]    @reverse @count .
Entity.in_rels:          [uid]    @reverse @count .

# GraphRel (reified temporal edge)
GraphRel.source:         uid      @reverse .
GraphRel.target:         uid      @reverse .
GraphRel.relation_type:  string   @index(hash) .
GraphRel.properties:     string .
GraphRel.valid_from:     dateTime @index(hour) .
GraphRel.valid_to:       dateTime @index(hour) .
GraphRel.active:         bool     @index(bool) .
GraphRel.source_episode: uid .
GraphRel.source_memory:  uid .
GraphRel.created_at:     dateTime .

# SharedPool / Snapshot / AuditLog
SharedPool.name:         string   @index(hash) @upsert .
SharedPool.created_by:   string .
SharedPool.created_at:   dateTime .
Snapshot.agent_id:       string   @index(hash) .
Snapshot.memory_refs:    string .                          # JSON: [{memory_xid, version}]
Snapshot.trigger:        string .
Snapshot.created_at:     dateTime .
AuditLog.agent_id:       string   @index(hash) .
AuditLog.operation:      string   @index(hash) .
AuditLog.memory_key:     string .
AuditLog.metadata:       string .
AuditLog.created_at:     dateTime @index(hour) .
```

## Why reified `GraphRel` (not facets)

The Postgres `edges` table carries per-edge `valid_from`, `valid_to`,
`relation_type`, `properties`, and two provenance FKs
(`source_episode_id`, `source_memory_id`). Three requirements force
reification:

1. **Provenance points at other nodes.** Facet values are scalars only;
   they cannot reference an Episode/Memory uid.
2. **"Current graph" must be an indexed query.** Postgres uses partial
   indexes `WHERE valid_to IS NULL`; facets aren't indexed, so a facet
   `valid_to` could only be answered by a full scan. `GraphRel.active`
   `@index(bool)` answers it directly.
3. **Invalidation is a node mutation.** Setting `valid_to = now()` on a
   contradicted edge is a clean upsert on a uid.

Cost: a 1-hop neighbour is two graph hops (`Entity → GraphRel → Entity`);
`@recurse` handles it. `active` is written transactionally with
`valid_to` (never one without the other).

## Operation → DQL mapping

Conventions: `$now`, `$agent`, `$vec` are query vars; mutations use
upsert blocks (`query` + `mutation`) for atomic read-modify-write,
replacing `ON CONFLICT` and `SELECT … then UPDATE`.

### writeMemory (upsert + version history)

Read current version in the query block, compute `nextVer` in TS (DQL
can't `max+1` in a mutation), then upsert: update the `Memory` and always
create a linked `MemoryVersion`. `expires_at` is computed in TS
(`now + ttl`). Audit is a separate fire-and-forget mutation.

```dql
upsert {
  query {
    m as var(func: eq(Memory.repo, $repo)) @filter(eq(Memory.key,$key) AND eq(Memory.is_deleted,false))
    me as var(func: eq(Memory.agent_id,$agent)) @filter(eq(Memory.key,$key) AND eq(Memory.is_deleted,false))
    var(func: uid(m, me)) { v as Memory.version }   # max read in TS → nextVer
  }
  mutation {
    set {
      uid(m) <Memory.value> $value .
      uid(m) <Memory.version> $nextVer .
      _:ver <dgraph.type> "MemoryVersion" .
      _:ver <MemoryVersion.version> $nextVer .
      _:ver <MemoryVersion.value> $value .
      uid(m) <Memory.versions> _:ver .
    }
  }
}
```

### readMemory / listMemories / delete

- **latest**: `func: eq(Memory.agent_id,$agent) @filter(eq(Memory.key,$key) AND eq(Memory.is_deleted,false) AND (NOT has(Memory.expires_at) OR gt(Memory.expires_at,$now)))`, `orderdesc: Memory.version`, `first:1`.
- **specific/all versions**: expand `Memory.versions(orderdesc: MemoryVersion.version)`.
- **list**: root on `Memory.repo`/`Memory.agent_id`, expiry+`is_deleted` filter, `orderdesc: Memory.created_at`, `first:$limit, offset:$offset`; `has_facts = count(Memory.facts)`; total via a `count(uid(...))` var block.
- **delete**: upsert sets `Memory.is_deleted true`.

### searchMemories (the centerpiece — 4 lists + TS fusion)

One multi-block DQL query returns the four ranked lists in one round
trip; **`rrfMerge` (RRF_K=60), diversification, and strengthening stay in
TS** (`memory-ranking.ts`).

```dql
{
  vmem(func: similar_to(Memory.embedding, 20, $vec))
       @filter(eq(Memory.is_deleted,false) AND (NOT has(Memory.expires_at) OR gt(Memory.expires_at,$now))) {
    Memory.xid Memory.key Memory.value Memory.agent_id }
  vfact(func: similar_to(Fact.embedding, 20, $vec))
        @filter(eq(Fact.agent_id,$agent) AND (eq($incInvalid,true) OR eq(Fact.active,true))) {
    Fact.xid Fact.text Fact.confidence Fact.memory { Memory.key } }
  kmem(func: anyoftext(Memory.value, $q), orderdesc: Memory.created_at, first: 20)
       @filter(eq(Memory.is_deleted,false)) { Memory.xid Memory.key Memory.value }
  kfact(func: anyoftext(Fact.text, $q), orderdesc: Fact.created_at, first: 20)
        @filter(eq(Fact.active,true)) { Fact.xid Fact.text }
}
```

- ranks 1..N from result order feed `rrfMerge`.
- **graph augmentation** (1-hop neighbours of detected entities): a DQL
  block rooted at `Entity.name` following `out_rels`/`in_rels`
  `@filter(eq(GraphRel.active,true))`.
- **retrieval strengthening** (fire-and-forget): two upserts over
  `func: uid($factXids)` / `func: uid($memoryXids)` reading current
  values, then writing `retrieval_count+1`, `last_retrieved_at=$now`,
  `half_life_days = min(+2, 365)`, and stale→observed revival — `LEAST`
  and the `CASE` computed in TS.

### persistFact + contradiction detection (cosine ≥ 0.92)

Over-fetch then threshold (no pre-filtered ANN):

```dql
{
  cand(func: similar_to(Fact.embedding, 40, $vec)) @filter(eq(Fact.active,true)) {
    u as uid  Fact.xid  Fact.text
    cos as Math( ... cosine(Fact.embedding, $vec) ... )
  }
  hits(func: uid(u)) @filter(ge(val(cos), 0.92)) { uid Fact.xid val(cos) }
}
```

Then an upsert: for each hit set `valid_to=$now`, `active=false`,
`invalidated_by=$newFactUid`, and create a `FactConflict` (old/new +
`similarity`).

### queryGraph (deep multi-hop — the headline change)

Replaces the two 1-hop UNION queries with `@recurse`; `active` filter at
every hop keeps it on the live graph; `loop:false` is cycle-safe.

```dql
query deepGraph($name: string, $depth: int, $rel: string) {
  start as var(func: eq(Entity.name, $name))
  result(func: uid(start)) @recurse(depth: $depth, loop: false) {
    uid Entity.name Entity.entity_type
    Entity.out_rels @filter(eq(GraphRel.active,true) AND (eq($rel,"") OR eq(GraphRel.relation_type,$rel)))
    Entity.in_rels  @filter(eq(GraphRel.active,true) AND (eq($rel,"") OR eq(GraphRel.relation_type,$rel)))
    GraphRel.relation_type GraphRel.valid_from
    GraphRel.source { uid Entity.name } GraphRel.target { uid Entity.name }
  }
}
```

Temporal/as-of traversal swaps the per-hop filter to
`le(GraphRel.valid_from,$t) AND (NOT has(GraphRel.valid_to) OR ge(GraphRel.valid_to,$t))`.

### upsertEntity / upsertEdge

- **upsertEntity**: upsert on `Entity.dedup_key` (`name|type|repo`); set
  `updated_at` if found, else create with a fresh `xid`.
- **upsertEdge**: query for the exact active edge (short-circuit) and for
  contradictory same-source-same-relation-different-target active edges;
  mutation invalidates the contradicted ones (`active=false`,
  `valid_to=$now`) and creates the new `GraphRel` with provenance edges.

### writeEpisode / lifecycle / ttl

- **writeEpisode**: upsert on `Episode.content_hash` — skip if present.
- **decay/eviction**: `@groupby(Memory.agent_id)` for counts; candidate
  fetch with `lt(Memory.created_at,$cutoff)` `orderasc`; scoring in TS;
  eviction = upsert `is_deleted=true`. Fact cap + stale transition use
  `Fact.agent_id` groupby and filtered blocks (the `COALESCE(last_retrieved_at, created_at)` filter splits into two blocks).
- **ttl**: upsert over `lt(Memory.expires_at,$now) AND eq(Memory.is_deleted,false)` setting `is_deleted=true`.

## Document-sourced facts (ADRs + specs)

ADRs and specs are authoritative, human-authored documents — decisions and
requirements — so they **contribute facts**, not just searchable chunks.
The path reuses the existing episode pipeline rather than a parallel
extractor (DRY): at ingest, a chunk whose `content_type` is `adr` or `spec`
is written as an `Episode` (`source = 'adr'|'spec'`, `ref = file_path`),
which triggers `extractFactsFromEpisode` exactly as a conversation would.
Facts inherit dedup, contradiction detection (cosine ≥ 0.92), and
strengthening for free.

Three properties keep it correct and cheap:

1. **Provenance.** Each extracted `Fact` points at its source via
   `Fact.episode` (the doc episode), and the episode's `ref` carries the
   `file_path`. "Which ADR asserts this?" is one hop.
2. **Confidence is elevated.** A conversation-sourced fact defaults to
   `observed`; ADR/spec facts are written `verified` — they're ratified
   decisions/requirements, the highest non-human-override tier. (The
   `extractFactsFromEpisode` confidence becomes a parameter; doc episodes
   pass `verified`, the existing callers keep `observed`.)
3. **Idempotency + self-correction.** The doc episode is gated on
   `Episode.content_hash` (`@upsert`) — re-ingesting an unchanged ADR/spec
   is a no-op, extracts nothing twice. When the document **changes**, the
   new content hash yields a new episode whose facts run through normal
   contradiction detection, invalidating the stale ones (`valid_to=$now`,
   `active=false`) and recording a `FactConflict`. The decision history
   stays queryable via `include_invalidated`.

This is the inverse-direction sibling of the spec-traceability graph's
`ADR`/`Statement` nodes: that graph is a deterministic, zero-LLM structural
projection; this is the LLM-extracted *semantic* layer (the "what we
decided / what we require", searchable as memory). Same documents, two
projections, no shared mutable state.

## UUID → xid backfill

- Each node's `xid` = the Postgres UUID, `@index(hash) @upsert` → a
  second run never duplicates.
- FKs translate by `xid` lookup. Two passes: (1) create all nodes by
  `xid`; (2) wire edges (`Fact.memory`, `GraphRel.source/target`,
  `invalidated_by`, snapshot refs) by resolving referents' `xid` → uid.
- App code keeps returning the **xid string** as `id`, so MCP/API
  contracts are unchanged.

## Honest gaps vs Postgres

| Postgres did | Dgraph | Workaround |
|---|---|---|
| Partial HNSW on valid facts | No pre-filtered ANN | Over-fetch topK 40 → `@filter(active)`; prune invalidated facts |
| BM25-ish? (actually ILIKE) | Stemmed boolean fulltext, no score | Recency rank (parity); `term` index for exact-word fallback |
| `max(version)+1`, `LEAST`, `COALESCE`-filter | Not in mutations / filters | TS read-compute-write inside upsert blocks |
| FK + cascade | None | App-owned integrity (writes funnel through few functions) |
| Multi-statement pooled txn | Per-block atomic upsert | Fold multi-step writes into one upsert block |

## Relationship to existing tables

- **Postgres stays** for `pipeline.*`, `lore.*`, `{team}.chunks`. Only
  `memory.*` moves. `assemble_context` becomes a cross-store fan-out
  (chunks/adrs from Postgres, memories/facts/episodes/graph from Dgraph)
  — it already fans out to its sources in parallel.
- Embeddings are still produced by Vertex AI `text-embedding-005` (768
  dims) in `mcp-server/src/db.ts`; Dgraph only stores and indexes them.
