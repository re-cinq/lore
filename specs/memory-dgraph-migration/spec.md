# Feature Specification: Memory → Dgraph Migration

| Field          | Value                                              |
|----------------|----------------------------------------------------|
| Feature        | Memory → Dgraph Migration                          |
| Status         | In Progress                                        |
| Created        | 2026-06-05                                         |
| Owner          | Platform Engineering                               |
| Benefits       | Unifies vector search + knowledge graph in one store; deep multi-hop traversal; ends the relational schema-drift class of outages; substrate for [`spec-traceability-graph`](../spec-traceability-graph/spec.md) |

This spec proposes migrating the agent memory subsystem off the PostgreSQL `memory` schema onto Dgraph to unify vector search and the knowledge graph in one store, enable deep multi-hop traversal, and end the relational schema-drift outages that have silently dropped memories from assembled context.

## Problem Statement

The agent memory subsystem stores everything in the PostgreSQL `memory`
schema: `memories`, `memory_versions`, `facts`, `fact_conflicts`,
`episodes`, `entities`, `edges`, `snapshots`, `shared_pools`,
`audit_log`. Two recurring pains motivate a move.

**Schema drift bites production, silently.** Code has shipped reading
columns that the prod migration never created:

- `memory.facts.confidence` shipped in code on 2026-04-07; the migration
  landed 2026-06-05. For ~60 days **every `searchMemories()` call threw
  `column f.confidence does not exist`**, and a swallowing `catch`
  dropped memories + episodes from *all* assembled context, org-wide,
  without an alert.
- `memory.memories.repo` shipped 2026-03-31; the migration landed
  2026-06-04 — two months of HTTP 500s on per-repo agents.
- `ttl-cleanup` queried `ttl_expires_at` / `deleted` when the columns are
  `expires_at` / `is_deleted` — broken since day one.

**The graph is anaemic.** The knowledge graph (`entities` + `edges`)
only ever does **1-hop** lookups (`queryLiveGraph()` —
[`shared/src/project/knowledge/live-graph.ts:19`](libs/shared/src/project/knowledge/live-graph.ts#L19)).
Multi-hop traversal in Postgres means recursive CTEs the team has not
written; relationship modelling is bolted onto a relational store.

**Honest framing (kept in this spec, not hidden):** memory retrieval is
~85% a *vector* workload (HNSW over 768-dim embeddings, RRF over
memories/facts/episodes); the graph is ~5–10% of retrieval value today.
A graph database is therefore justified **only because Dgraph also has
native vectors** — the win is unifying vector search + graph traversal in
one store and one query, not "graph for its own sake." Moving a pure
vector workload to a graph DB with no vectors would be a mistake; Dgraph
≥ v24 removes that objection.

## Solution

Move the `memory` schema to **Dgraph** behind a `MemoryStore` interface
seam, mirroring the existing backend-interface pattern
([`lease-backends.ts`](libs/shared/src/project/leases/lease-backends.ts)
`LeaseBackend`, [`platform.ts`](../../apps/floor/src/ports/platform.ts)
`CodePlatform`). Postgres stays for everything else — `pipeline.*`,
`lore.*`, and the per-team `{schema}.chunks` repo-context tables. Only
the `memory` schema moves.

The ranking brain stays in TypeScript: Reciprocal Rank Fusion,
session diversification, transfer scoring, and importance scoring remain
pure functions shared by both backends, so retrieval behaviour is
provably identical across the cutover. Dgraph is a pure
storage + ANN + traversal backend.

Cutover is **strangler-fig**: extract a behavior-preserving
`PostgresMemoryStore` first, add `DgraphMemoryStore` behind
`LORE_MEMORY_BACKEND`, backfill, run a read-shadow soak with a divergence
metric, then flip a single flag. Postgres `memory.*` stays read-only for
a rollback window.

### Dgraph capability facts (verified against current docs, 2026-06)

| Capability | Finding | Source |
|---|---|---|
| Native vectors | `float32vector` type + `@index(hnsw(metric:"cosine"))` + `similar_to(pred, topK, $vec)`; since **v24.0** (mid-2024) | [similarity-search](https://docs.dgraph.io/learn/howto/similarity-search/), [v24 blog](https://dgraph.io/blog/post/v24-dql/) |
| Multi-hop traversal | DQL `@recurse(depth, loop)` + per-level `@filter` + `var` blocks | [recurse](https://docs.hypermode.com/dgraph/dql/recurse) |
| Keyword search | `@index(fulltext)` (stemmed, stop-worded) / `@index(term)` — **boolean match, no BM25/TF-IDF score** | [search directives](https://docs.dgraph.io/graphql/schema/directives/search/) |
| Facets | Edge key/values are **not indexable** → temporal edges must be reified nodes | [issue #4034](https://github.com/dgraph-io/dgraph/issues/4034) |
| Pre-filtered ANN | `similar_to` is a root func over the HNSW graph; **cannot pre-restrict** the walk → over-fetch + `@filter` | [filter + vector](https://discuss.dgraph.io/t/how-to-filter-by-graph-paths-and-vector-search-together/19918/2) |
| Version / license / steward | Current stable **v25.x**, single Apache-2.0 build; repo `hypermodeinc/dgraph`; stewardship Hypermode → **Istari Digital** (Oct 2025) | [releases](https://github.com/dgraph-io/dgraph/releases), [Istari](https://discuss.dgraph.io/t/dgraph-welcome-to-istari/20021) |

### Design decisions (locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Seam | **`MemoryStore` interface** in `shared/`, `PostgresMemoryStore` extracted first, `DgraphMemoryStore` added behind a flag | Mirrors `LeaseBackend`/`CodePlatform`; lets the cutover be reversible and the two backends share ranking code |
| Backend selection | **`LORE_MEMORY_BACKEND=postgres\|dgraph`** (default `postgres`); `selectMemoryStore()` throws loudly if the chosen backend's client is missing | Single flag flip + rollback; never silently degrade |
| Query language | **DQL** (not GraphQL) | `@recurse`, `similar_to`, multi-block reads, `var`/`Math` are DQL-native |
| Temporal edges | **Reified `GraphRel` nodes** + indexed `GraphRel.active` bool mirror of `valid_to` | Facets aren't indexable; the bool index keeps `@recurse` on the live subgraph fast and answers "current graph" without a scan |
| Identity | **UUIDs preserved as `xid`** (`@index(hash) @upsert`) | Idempotent backfill; unchanged external/MCP ids |
| Vectors | `float32vector @index(hnsw(metric:"cosine"))`; **RRF + keyword fusion stay in TS** | Matches today's `vector_cosine_ops`; Dgraph has no BM25, so fusion lives where it already lives |
| Keyword search | `@index(fulltext)` stemmed match, **recency-ranked** | Functional parity with today's `ILIKE` (also unscored); documented semantic shift (stemming) |
| Contradiction detection | `similar_to` over-fetch (topK 40) → `@filter(active)` → cosine threshold ≥ 0.92 in a second block | No pre-filtered ANN; over-fetch + lifecycle pruning preserves recall |
| Aggregates | `max(version)+1`, `LEAST`, `COALESCE`-in-filter move to **TS read-compute-write** inside upsert blocks | DQL mutations can't compute these server-side |
| Cutover | **Read-shadow soak → flag flip** (no dual-write) | One source of truth at a time; divergence measured before flip; the 60-day silent failure means we fail loud, never swallow |
| ACL | **Scoped runtime user** (`lore-memory-app`), guardian only in a one-time bootstrap Job | Least-privilege; no superuser at runtime |
| Secrets | **ESO + Workload Identity**, GCP Secret Manager | No long-lived creds, per repo convention |

## User Experience

No developer-facing UX change. The MCP tools (`lore_write_memory`,
`lore_read_memory`, `lore_search_memory`, `lore_query_graph`, `lore_write_episode`,
`lore_assemble_context`, `lore_agent_stats`) keep their schemas and return shapes —
ids are still the original UUIDs (carried as `xid`).

The one new operator-facing capability is **deep graph traversal**:
`lore_query_graph` gains a `depth` parameter (1–N) that previously could only
return 1-hop neighbours.

```
# Before (Postgres): only direct neighbours
lore_query_graph(entity="lore-agent")
  → lore-agent --uses--> postgres
  → lore-agent --owns--> review-reactor

# After (Dgraph @recurse, depth=3): the live subgraph around an entity
lore_query_graph(entity="lore-agent", depth=3)
  → lore-agent --uses--> postgres --hosts--> memory-schema
  → lore-agent --owns--> review-reactor --depends-on--> github-webhooks
  → … (active edges only, cycle-safe)
```

Operators get a `LORE_MEMORY_BACKEND` env on the agent + mcp-server
deployments and a Dgraph dashboard; the rollback is a one-value flip.

## Architecture

```
┌────────────────────  mcp-server / agent (Node)  ──────────────────────┐
│  memoryStore()  ──►  MemoryStore (shared/src/memory-store.ts)          │
│        selectMemoryStore({ pgPool, dgraph })  by LORE_MEMORY_BACKEND   │
│              │                                   │                     │
│        PostgresMemoryStore                 DgraphMemoryStore           │
│        (shared/src/postgres-              (shared/src/dgraph-          │
│         memory-store.ts)                    memory-store.ts)           │
│              │                                   │ dgraph-js (gRPC)    │
│   RRF / diversification / transfer / importance scoring               │
│   (shared/src/memory-ranking.ts) — IDENTICAL for both backends        │
└───────────────┬───────────────────────────────────┬──────────────────┘
                │ SQL (unchanged)                     │ DQL
                ▼                                      ▼
   ┌───────────────────────┐            ┌──────────────────────────────┐
   │ Postgres (stays)      │            │  Dgraph (lore-memory ns)      │
   │  pipeline.* lore.*    │            │   zero + alpha StatefulSet    │
   │  {team}.chunks        │            │   memory types + HNSW vectors │
   │  memory.* (read-only  │            │   reified GraphRel edges      │
   │   during rollback win)│            │   ACL: lore-memory-app user   │
   └───────────────────────┘            └──────────────────────────────┘
```

The DQL schema, predicate indexes, and per-operation query/mutation
mapping live in [`data-model.md`](./data-model.md). The phased rollout
and rollback live in [`plan.md`](./plan.md).

## API

No new HTTP API. Two internal surfaces change shape behind the seam.

**`lore_query_graph` MCP tool** gains `depth`:

```jsonc
// request (additive; depth defaults to 1 for back-compat)
{ "entity": "lore-agent", "depth": 3, "relation_type": null, "include_invalidated": false }

// response (unchanged shape — direction/relation/related_entity per hop)
[
  { "entity": "lore-agent", "relation": "uses", "related_entity": "postgres", "direction": "outgoing", "depth": 1, "valid_from": "2026-05-01T…" },
  { "entity": "postgres", "relation": "hosts", "related_entity": "memory-schema", "direction": "outgoing", "depth": 2, "valid_from": "2026-05-02T…" }
]
```

**Backfill Job** (one-shot, internal) reports its parity gates:

```jsonc
// stdout summary (non-zero exit if any gate fails)
{
  "tables": { "memories": { "pg": 412, "dgraph": 412 }, "facts": { "pg": 3120, "dgraph": 3120 }, "…": {} },
  "embedding_fidelity": { "sampled": 200, "dim_ok": 200, "self_cosine_ok": 200 },
  "retrieval_parity": { "sampled_queries": 50, "mean_topk_jaccard": 0.87, "below_threshold": 0 }
}
```

The retrieval-parity number is a set-based top-K Jaccard: `jaccard(a, b)` treats each input as a set (deduping repeats), returns |a∩b| / |a∪b|, scores disjoint sets 0 and two empty sets 1; `meanTopkJaccard` averages the per-query Jaccards and returns 0 (never NaN) on an empty sample so the retrieval gate fails loudly rather than passing vacuously. ([validated by `backfill-parity.test.ts:9`](libs/shared/src/backfill-parity.test.ts#L9), [`backfill-parity.test.ts:13`](libs/shared/src/backfill-parity.test.ts#L13), [`backfill-parity.test.ts:17`](libs/shared/src/backfill-parity.test.ts#L17), [`backfill-parity.test.ts:21`](libs/shared/src/backfill-parity.test.ts#L21), [`backfill-parity.test.ts:25`](libs/shared/src/backfill-parity.test.ts#L25), [`backfill-parity.test.ts:31`](libs/shared/src/backfill-parity.test.ts#L31), [`backfill-parity.test.ts:35`](libs/shared/src/backfill-parity.test.ts#L35))

## Data Model

Full DQL type system, predicate/index definitions, and the
operation→DQL mapping are in [`data-model.md`](./data-model.md). Summary
of the node types and how they map from Postgres:

| Postgres table | Dgraph type | Notes |
|---|---|---|
| `memories` | `Memory` | `embedding` → `float32vector`; `version` history via `MemoryVersion` nodes |
| `memory_versions` | `MemoryVersion` | linked `Memory.versions` |
| `facts` | `Fact` | `active` bool mirror of `valid_to`; `agent_id` denormalized |
| `fact_conflicts` | `FactConflict` | `old_fact`/`new_fact` edges |
| `episodes` | `Episode` | `content_hash` `@upsert` dedup |
| `entities` | `Entity` | `dedup_key = name\|type\|repo` `@upsert` |
| `edges` | `GraphRel` (reified) | temporal + provenance edges to `Episode`/`Memory` |
| `snapshots` | `Snapshot` | `memory_refs` JSON string |
| `shared_pools` | `SharedPool` | `name` `@upsert` |
| `audit_log` | `AuditLog` | append-only |

## File Changes

| File | Change |
|------|--------|
| `shared/src/memory-store.ts` | NEW: `MemoryStore` interface + `setMemoryStore`/`memoryStore`/`selectMemoryStore` |
| `shared/src/postgres-memory-store.ts` | NEW: `PostgresMemoryStore` (behavior-preserving extraction of current SQL) |
| `shared/src/dgraph-memory-store.ts` | NEW: `DgraphMemoryStore` (DQL) |
| `shared/src/dgraph-client.ts` | NEW: `dgraph-js` gRPC wrapper (`query`/`mutate`), analogue of `db.ts` pool |
| `shared/src/memory-ranking.ts` | NEW: extracted pure `rrfMerge`, `computeTransferScore`, `scoreImportance`, diversification |
| `shared/src/fact-extraction.ts` | NEW: extracted pure `parseFacts`, `parseGraphExtraction` |
| `mcp-server/src/memory.ts` | Modify: SQL bodies move into `PostgresMemoryStore`; module delegates to `memoryStore()` |
| `mcp-server/src/memory-search.ts` | Modify: query bodies move behind the store; RRF/strengthening import from `memory-ranking.ts` |
| `mcp-server/src/facts.ts` | Modify: fact persistence + contradiction detection move behind the store |
| `mcp-server/src/graph.ts` | Modify: entity/edge upsert + `queryLiveGraph` move behind the store; gains `@recurse` depth |
| `mcp-server/src/index.ts` | Modify (~L1649): `setMemoryStore(selectMemoryStore(...))`; `isMemoryDbAvailable()` → `memoryStore().isAvailable()` |
| `agent/src/jobs/cron/memory-lifecycle.ts` | Modify: decay/consolidation call `memoryStore()` data-access methods |
| `agent/src/jobs/cron/ttl-cleanup.ts` | Modify: `expireDueMemories()` via the store (also fixes the column-name bug) |
| `shared/src/shadow-memory-store.ts` | NEW: `ShadowMemoryStore` (read-shadow + divergence metric) |
| `scripts/migrate/backfill-memory-to-dgraph.ts` | NEW: two-pass xid-keyed exporter + parity gates |
| `scripts/migrate/backfill-memory-to-dgraph.sh` | NEW: runner (local) / K8s Job (prod) |
| `scripts/infra/setup-memory-dgraph-schema.sh` | NEW: applies the DQL schema (sibling of `setup-memory-schema.sh`) |
| `scripts/dev-local.sh` | Modify: add a `lore-dgraph` standalone container beside `lore-postgres` |
| `terraform/modules/gke-mcp/dgraph-helm/` | NEW: zero+alpha chart + ACL bootstrap Job + export CronJob |
| `terraform/external-secrets.tf` | Modify: `ExternalSecret` for `lore-dgraph-credentials` |
| `terraform/modules/gke-mcp/agent-helm/values.yaml` | Modify: `LORE_MEMORY_BACKEND` env (+ shadow flag) |
| `CLAUDE.md` | Modify: document the `MemoryStore` seam + Dgraph backend |

## Acceptance Criteria

1. A `MemoryStore` interface exists in `shared/`; `PostgresMemoryStore` implements every method by delegating to the current SQL, and all existing memory/facts/graph/context-assembly tests stay green with `LORE_MEMORY_BACKEND` unset (default `postgres`). ([validated by `returns version 1 for a brand-new key`](libs/shared/src/postgres-memory-store.test.ts#L38), [validated by `returns the latest stored value with version 1 for a single write`](libs/shared/src/postgres-memory-store.test.ts#L160), [validated by `soft-deletes so readMemory returns nothing`](libs/shared/src/postgres-memory-store.test.ts#L81), [validated by `returns total 2 and the two live keys, excluding the soft-deleted one`](libs/shared/src/postgres-memory-store.test.ts#L117))

2. `selectMemoryStore()` returns `DgraphMemoryStore` when `LORE_MEMORY_BACKEND=dgraph`, `PostgresMemoryStore` otherwise, and throws (not returns null) when the selected backend's client is absent. ([validated by `returns a postgres store when LORE_MEMORY_BACKEND is unset`](libs/shared/src/memory-store.test.ts#L39), [validated by `throws when postgres backend is selected without a pgPool`](libs/shared/src/memory-store.test.ts#L45), [validated by `throws when dgraph backend is selected without a dgraph client`](libs/shared/src/memory-store.test.ts#L49), [validated by `returns a dgraph store when dgraph backend is selected with a client`](libs/shared/src/memory-store.test.ts#L54))

3. `DgraphMemoryStore` passes the same behavioral test fixtures as `PostgresMemoryStore` against a real local Dgraph container (no mocks): write→read version increment, soft-delete + TTL exclusion, paginated list, RRF hybrid search, contradiction detection at cosine ≥ 0.92, episode `content_hash` dedup, entity/edge temporal invalidation. ([validated by `returns the stored value at version 1 after writeMemory then readMemory of a new key`](libs/shared/src/dgraph-memory-store.test.ts#L210), [validated by `returns version 2 and the latest value after writing the same key twice`](libs/shared/src/dgraph-memory-store.test.ts#L232), [validated by `soft-deletes so readMemory returns nothing`](libs/shared/src/dgraph-memory-store.test.ts#L287), [validated by `excludes a memory whose expires_at is in the past`](libs/shared/src/dgraph-memory-store.test.ts#L252), [validated by `returns total 2 and the two live keys, excluding the soft-deleted one`](libs/shared/src/dgraph-memory-store.test.ts#L302), [validated by `searchMemories returns the memory whose value matches the keyword query`](libs/shared/src/dgraph-memory-store.test.ts#L324), [validated by `searchMemories returns the vector-nearest memory when the keyword query matches nothing`](libs/shared/src/dgraph-memory-store.test.ts#L351), [validated by `invalidates the prior fact and records a FactConflict for a near-duplicate embedding`](libs/shared/src/dgraph-memory-store.test.ts#L146), [validated by `writeEpisode of identical content twice creates exactly one Episode node`](libs/shared/src/dgraph-memory-store.test.ts#L418), [validated by `upsertEdge creates an active GraphRel of the given relation_type from source to target`](libs/shared/src/dgraph-memory-store.test.ts#L505), [validated by `invalidates the prior edge when a same-source same-relation edge points at a different target`](libs/shared/src/dgraph-memory-store.test.ts#L550), [validated by `persistFact writes an active Fact node retrievable for the agent`](libs/shared/src/dgraph-memory-store.test.ts#L74))

4. `lore_query_graph` performs multi-hop traversal via `@recurse` to a caller-supplied `depth`, returns only `active` edges by default, and is cycle-safe (`loop:false`). ([validated by `queryGraph returns the 1-hop outgoing neighbour as a hop at depth 1`](libs/shared/src/dgraph-memory-store.test.ts#L597), [validated by `traverses two hops so A--uses-->B--hosts-->C yields the depth-2 hop B--hosts-->C`](libs/shared/src/dgraph-memory-store.test.ts#L621), [validated by `excludes an invalidated (active=false) edge from traversal by default`](libs/shared/src/dgraph-memory-store.test.ts#L647), [validated by `terminates on a cycle A--links-->B--links-->A without infinite recursion`](libs/shared/src/dgraph-memory-store.test.ts#L668))

5. RRF, session diversification, transfer scoring, and importance scoring are imported by both stores from `shared/src/memory-ranking.ts` — one definition, identical results. ([validated by `carries confidence from the candidate onto the fused result`](libs/shared/src/memory-ranking.test.ts#L11), [validated by `returns 0.5 for neutral text with no portable or local keywords`](libs/shared/src/memory-ranking.test.ts#L29), [validated by `keeps only the 3 highest-scoring from one agent_id::source over the cap`](libs/shared/src/memory-ranking.test.ts#L53), [validated by `returns 10 for a fresh memory with no score adjustments`](libs/shared/src/memory-ranking.test.ts#L113))

6. The backfill exporter preserves every Postgres UUID as the node `xid`, preserves 768-dim embeddings (dim == 768, cosine(self) == 1.0 on a sample), resolves all relationships, and is idempotent (a second run leaves node counts unchanged). ([validated by `creates a Memory node whose Memory.xid equals the Postgres memories row id`](libs/shared/src/backfill-memory.test.ts#L107), [validated by `preserves the 768-dim embedding so cosine(original, stored) is 1.0`](libs/shared/src/backfill-memory.test.ts#L235), [validated by `points Fact.memory at the Memory node carrying the facts.memory_id xid`](libs/shared/src/backfill-memory.test.ts#L149), [validated by `creates exactly one Memory node per xid after running twice`](libs/shared/src/backfill-memory.test.ts#L196))

7. The backfill Job exits non-zero unless row-count parity holds per table and retrieval top-K Jaccard ≥ 0.8 on a sampled query set; the Jaccard gate is inclusive (passes at exactly the threshold) and the threshold is configurable (a stricter custom threshold fails an otherwise-passing sample). ([validated by `passes with exit 0 when every table count matches and mean jaccard is 0.87`](libs/shared/src/backfill-parity.test.ts#L41), [validated by `fails with non-zero exit naming the table when facts count mismatches`](libs/shared/src/backfill-parity.test.ts#L57), [validated by `fails with non-zero exit naming the jaccard gate when tables match but mean jaccard is 0.5`](libs/shared/src/backfill-parity.test.ts#L73), [validated by `accumulates both a table-mismatch and a jaccard failure when both gates fail`](libs/shared/src/backfill-parity.test.ts#L101), [validated by `passes when mean jaccard is exactly the threshold 0.8 (gate is >=)`](libs/shared/src/backfill-parity.test.ts#L88), [validated by `fails a jaccard of 0.9 against a stricter custom threshold of 0.95`](libs/shared/src/backfill-parity.test.ts#L119))

8. `ShadowMemoryStore` serves reads from the primary (never the shadow) even when the shadow throws, emits a `lore.memory.shadow_divergence` metric only on genuine divergence — never when the two agree, and a shadow throw is not counted as a divergence — and logs (never swallows) shadow errors. ([validated by `serves the primary result when the shadow read throws`](libs/shared/src/shadow-memory-store.test.ts#L78), [validated by `emits lore.memory.shadow_divergence when primary and shadow differ`](libs/shared/src/shadow-memory-store.test.ts#L60), [validated by `logs the shadow error through the injected sink when the shadow read throws`](libs/shared/src/shadow-memory-store.test.ts#L90), [validated by `serves readMemory from the primary, not the shadow`](libs/shared/src/shadow-memory-store.test.ts#L48), [validated by `emits no divergence metric when primary and shadow agree`](libs/shared/src/shadow-memory-store.test.ts#L111), [validated by `emits no divergence metric when the shadow read throws (a throw is not a divergence)`](libs/shared/src/shadow-memory-store.test.ts#L129))

9. Dgraph runs under ACL with a scoped `lore-memory-app` runtime user; the guardian credential is used only by a `pre-install` bootstrap Job; runtime creds come from ESO + Secret Manager + Workload Identity with no value hardcoded in any chart. The guard returns no violations for an empty document set, never mistakes a `secretKeyRef` env (no literal value) for a hardcoded credential, and never flags the `pre-install` bootstrap Job for using the guardian credential. *(Enforced by the `auditDgraphAcl` policy guard — the deployment manifests/charts that satisfy it are the remaining infra build.)* ([validated by `returns no violations for a fully compliant Dgraph deployment set`](libs/shared/src/dgraph-acl-policy.test.ts#L119), [validated by `flags a dgraph alpha workload whose args do not enable --acl`](libs/shared/src/dgraph-acl-policy.test.ts#L41), [validated by `flags a runtime StatefulSet that references the guardian credential`](libs/shared/src/dgraph-acl-policy.test.ts#L67), [validated by `flags a ServiceAccount missing the Workload Identity annotation`](libs/shared/src/dgraph-acl-policy.test.ts#L104), [validated by `flags a container env that hardcodes a credential value`](libs/shared/src/dgraph-acl-policy.test.ts#L9), [validated by `returns no violations for no documents`](libs/shared/src/dgraph-acl-policy.test.ts#L5), [validated by `does not flag a secretKeyRef env (no literal value) as a hardcoded credential`](libs/shared/src/dgraph-acl-policy.test.ts#L198), [validated by `does not flag the pre-install bootstrap Job for using the guardian credential`](libs/shared/src/dgraph-acl-policy.test.ts#L229))

10. `scripts/dev-local.sh` brings up a local Dgraph container and applies the schema; `LORE_MEMORY_BACKEND=dgraph npm start` exercises the memory MCP tools end-to-end with no Postgres `memory.*` access. ([validated by `declares the HNSW vector index and the xid upsert index`](libs/shared/src/setup-memory-dgraph-schema.test.ts#L51), [validated by `is idempotent — a second apply leaves the predicate schema unchanged`](libs/shared/src/setup-memory-dgraph-schema.test.ts#L66))

11. Rollback is a single Helm value (`LORE_MEMORY_BACKEND=postgres`) + rollout; Postgres `memory.*` remains read-only and queryable for the rollback window. *(The single-value flip is `selectMemoryStore`; the read-only Postgres window is an infra/DB-grant concern.)* ([validated by `rolls back to postgres on the single value LORE_MEMORY_BACKEND=postgres`](libs/shared/src/memory-store.test.ts#L67), [validated by `flips the served backend with only the LORE_MEMORY_BACKEND value (cutover and rollback)`](libs/shared/src/memory-store.test.ts#L74), [validated by `throws on an unrecognized LORE_MEMORY_BACKEND value instead of silently serving postgres`](libs/shared/src/memory-store.test.ts#L88))

The active store is held in a module-global registry: `setMemoryStore(store)` registers it and `memoryStore()` returns exactly that instance, throwing when no store has been set. ([validated by `throws when no store has been set`](libs/shared/src/memory-store.test.ts#L10), [validated by `returns the store registered via setMemoryStore`](libs/shared/src/memory-store.test.ts#L14))

## Limitations & Open Questions

1. **No pre-filtered ANN.** Postgres's partial HNSW on valid facts has no Dgraph equivalent; `similar_to` over-fetches then `@filter`s on `active`. Many invalidated near-duplicates could push a real contradiction outside topK — mitigated by raising topK (40–60) and aggressive lifecycle pruning of `active=false` facts. Recall is verified by the parity gate.
2. **No BM25.** Keyword search is stemmed boolean match, recency-ranked — functional parity with today's `ILIKE`, but `anyoftext` stems/stop-words differently than substring match (`%config%` vs "configuration"). A `term` index is added for exact-word fallback; semantics are tested query-by-query.
3. **No FK/cascade.** Referential integrity (`invalidated_by`, episode/memory links) becomes the app's responsibility — low risk since writes funnel through few functions.
4. **Aggregates move to the app.** `max(version)+1`, `LEAST`, `COALESCE`-in-filter become TS read-compute-write inside upsert blocks; the `COALESCE(last_retrieved_at, created_at)` stale filter needs a two-block split or a maintained `effective_at` predicate.
5. **A second stateful system.** Dgraph adds operational surface (zero/alpha, ACL, backups) to a project whose pitch is "one install command." Sizing is small (decay caps at 500 memories / 2000 facts per agent) so a 1-zero/1-alpha cluster suffices; revisit replica groups if data grows.
6. **Steward risk.** Dgraph's commercial stewardship has changed hands (Hypermode → Istari). The Apache-2.0 build and the `MemoryStore` seam (which keeps Postgres a live, tested fallback) are the hedge. **Open question:** how long to keep `PostgresMemoryStore` maintained after a successful flip — proposal: through one full rollback window plus one quarter.
7. **Embedding generation unchanged.** Vertex AI `text-embedding-005` (768-dim) still runs in app code; only storage/index move. If the embedding model ever changes dimensions, both backends re-embed identically.
