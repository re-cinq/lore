# Implementation Plan: Memory → Dgraph Migration

| Field   | Value                                          |
|---------|------------------------------------------------|
| Feature | Memory → Dgraph Migration                      |
| Spec    | [spec.md](spec.md)                             |
| Data    | [data-model.md](data-model.md)                 |
| Status  | Draft                                          |
| Created | 2026-06-05                                     |

## Overview

A strangler-fig migration of the `memory` schema from Postgres to
Dgraph, behind a `MemoryStore` seam. The ordering is deliberate:
extract a behavior-preserving Postgres implementation first (zero
behaviour change, all existing tests stay green), add the Dgraph
implementation tested against a real container, backfill, soak behind a
read-shadow with a divergence metric, then flip one flag. Postgres
`memory.*` stays read-only for a rollback window.

The cardinal rule, given the 60-day silent-failure history: **fail
loud**. Stores `throw` on backend errors; the only graceful-degradation
path is the existing "no store configured → file fallback / `LORE_API_URL`
proxy" branch.

## Phase 0: Stand up Dgraph + schema

### 0.1 Local container

**File:** `scripts/dev-local.sh`

Add a `lore-dgraph` standalone container beside `lore-postgres` (same
idempotent create/start/health-probe shape; probe `:8080/health`).
Publish `:8080` (HTTP) + `:9080` (gRPC); bind-mount `.lore-dgraphdata`
(git-ignored). ACL off locally (parity with local plain Postgres).

### 0.2 Schema applier

**File:** `scripts/infra/setup-memory-dgraph-schema.sh` (NEW, sibling of
`setup-memory-schema.sh`)

Applies the DQL type system + predicate/index definitions from
[data-model.md](data-model.md) (predicate types, `@index(hnsw)` on the
768-dim vector predicates, `xid` `@index(hash) @upsert`). Invoked from
`dev-local.sh` after the container is healthy. Idempotent.

### 0.3 Client wrapper

**File:** `shared/src/dgraph-client.ts` (NEW)

Thin `dgraph-js` (gRPC) wrapper exposing `query(dql, vars)` and
`mutate(upsertBlock)` — the analogue of the `pg` pool in `db.ts`. Holds
connection config; pure helpers extracted for testability.

## Phase 1: Seam + PostgresMemoryStore (no behaviour change)

### 1.1 Extract pure ranking/scoring

**Files:** `shared/src/memory-ranking.ts`, `shared/src/fact-extraction.ts`
(NEW)

Move `rrfMerge` (RRF_K=60), `computeTransferScore`, `scoreImportance`,
session diversification, `parseFacts`, `parseGraphExtraction` out of
`mcp-server/src/memory-search.ts` / `facts.ts` verbatim. Both backends
import these — one definition of behaviour.

### 1.2 Define the interface

**File:** `shared/src/memory-store.ts` (NEW)

```ts
export interface MemoryStore {
  readonly backend: 'postgres' | 'dgraph';
  isAvailable(): Promise<boolean>;
  writeMemory(input): Promise<WriteResult>;
  readMemory(key, agentId?, version?): Promise<…>;
  deleteMemory(key, agentId?): Promise<{ key; deleted }>;
  listMemories(opts): Promise<{ memories; total }>;
  searchMemories(input): Promise<MemorySearchResult[]>;   // strengthening internal
  persistFact(input): Promise<{ id }>;
  invalidateContradictions(input): Promise<number>;
  writeEpisode(input): Promise<string | null>;            // dedup → null
  upsertEntity(name, type, repo): Promise<string>;
  upsertEdge(input): Promise<void>;
  queryGraph(input): Promise<LiveGraphResult[]>;           // depth-aware
  neighbors(names): Promise<GraphNeighbor[]>;
  allEntityNames(): Promise<string[]>;
  sharedWrite/sharedRead/createSnapshot/restoreSnapshot(…);
  agentHealth/agentStats(agentId?);
  audit(entry): Promise<void>;
  // lifecycle data-access (scoring stays in memory-ranking.ts):
  agentsOverMemoryCap(cap); decayCandidates(…); softDeleteMemories(ids);
  agentsOverFactCap(…); evictOldInvalidatedFacts(…); transitionStaleFacts(…);
  recentValidFacts(…); upsertConsolidatedMemory(…);
  expireDueMemories(): Promise<number>;
}
export function setMemoryStore(s): void
export function memoryStore(): MemoryStore   // throws if unset
export function selectMemoryStore({ pgPool, dgraph }): MemoryStore  // throws if chosen client missing
```

### 1.3 Implement PostgresMemoryStore

**File:** `shared/src/postgres-memory-store.ts` (NEW)

Each method delegates to the current SQL (lifted from `memory.ts`,
`memory-search.ts`, `facts.ts`, `graph.ts`) verbatim. No behaviour
change — the existing tests are the safety net.

### 1.4 Wire the seam

**File:** `mcp-server/src/index.ts` (~L1649)

`setMemoryPool(dbPool)` → `setMemoryStore(selectMemoryStore({ pgPool: dbPool, dgraph }))`.
`isMemoryDbAvailable()` → `await memoryStore().isAvailable()`. Agent
crons (`memory-lifecycle.ts`, `ttl-cleanup.ts`) call `memoryStore()`
instead of raw `query()`. Default `LORE_MEMORY_BACKEND=postgres` → all
existing tests stay green.

## Phase 2: DgraphMemoryStore (against a real container)

**File:** `shared/src/dgraph-memory-store.ts` (NEW)

Implement method-by-method per the operation→DQL mapping in
[data-model.md](data-model.md), one failing test at a time against the
local Dgraph container (no mocks). Order: writeMemory/readMemory →
delete/list → searchMemories (RRF parity) → persistFact +
invalidateContradictions → writeEpisode dedup → upsertEntity/upsertEdge +
`@recurse` queryGraph → pools/snapshots → stats/health → audit →
lifecycle data-access → expireDueMemories. Each asserts the SAME
expectations as the Postgres-store tests (shared fixtures).

## Phase 3: Backfill

**Files:** `scripts/migrate/backfill-memory-to-dgraph.ts` + `.sh` (NEW)

Two-pass, xid-keyed, idempotent exporter (see data-model §backfill). Run
locally via the `.sh`; in prod as a one-shot K8s Job in `mcp-servers`
using the runtime image + scoped Dgraph user. Verify gates (exit
non-zero on failure): row-count parity per table; embedding fidelity
(dim==768, cosine(self)==1.0 on a sample); retrieval parity (top-K
Jaccard ≥ 0.8 on sampled queries, reusing `memory-ranking.ts`).

## Phase 4: Shadow soak + parity gates

**File:** `shared/src/shadow-memory-store.ts` (NEW)

`ShadowMemoryStore{ primary: Postgres, shadow: Dgraph }`: serve reads
from `primary`, fire `shadow` async, compare by the parity metric, emit
`lore.memory.shadow_divergence` (OTEL) + structured log. **Shadow errors
logged loud, never affect the response.** Writes during this phase go to
Postgres only; an incremental backfill (keyed on a `created_at`
high-water mark) keeps Dgraph synced. Enabled by `LORE_MEMORY_SHADOW=dgraph`.

**Gate to flip:** divergence under threshold sustained ~7 days + counts
equal after each incremental backfill + acceptable p95 latency.

## Phase 5: Flip

**File:** `terraform/modules/gke-mcp/agent-helm/values.yaml`

Set `LORE_MEMORY_BACKEND=dgraph` (Helm value → env). `selectMemoryStore`
now returns `DgraphMemoryStore` as primary. Optionally invert the shadow
(`LORE_MEMORY_SHADOW=postgres`) for a reverse-validation window. During
this phase, wrap Dgraph writes to also enqueue a best-effort mirror write
to Postgres for the rollback window (the one acceptable, scoped
dual-write; failures logged, non-blocking).

## Phase 6: Decommission

After the rollback window closes with zero divergence incidents: drop the
mirror-write, drop Postgres `memory.*`, revoke the `lore` grant on the
`memory` schema, and remove `setup-memory-schema.sh` from the deploy
path. Postgres itself stays for `pipeline.*`, `lore.*`, `{team}.chunks`.

## Deployment

**Files:** `terraform/modules/gke-mcp/dgraph-helm/` (NEW),
`terraform/external-secrets.tf`

- Chart mirrors `lore-db-helm`: zero + alpha StatefulSet (1 zero, 1
  alpha; data is small — decay caps at 500 memories / 2000 facts per
  agent), Services, PVC. Namespace `lore-memory`.
- **ACL least-privilege**: `--acl` on; guardian used only by a
  `pre-install` bootstrap Job that creates a scoped `lore-memory-app`
  user (read+write on the memory predicates only). Runtime authenticates
  as that user; password via a new `ExternalSecret`
  (`lore-dgraph-credentials`) through the existing `gcp-secret-manager`
  ClusterSecretStore + Workload Identity. No creds in charts.
- **Backup**: a CronJob runs Dgraph `/admin/export` (JSON/RDF) to a GCS
  bucket (WI SA + lifecycle retention), analogous to CNPG backups.

## Files Changed Summary

| File | Phase | Change |
|------|-------|--------|
| `scripts/dev-local.sh` | 0 | local Dgraph container |
| `scripts/infra/setup-memory-dgraph-schema.sh` | 0 | NEW DQL schema applier |
| `shared/src/dgraph-client.ts` | 0 | NEW gRPC wrapper |
| `shared/src/memory-ranking.ts`, `fact-extraction.ts` | 1 | NEW extracted pure fns |
| `shared/src/memory-store.ts` | 1 | NEW interface + selector |
| `shared/src/postgres-memory-store.ts` | 1 | NEW Pg impl |
| `mcp-server/src/{memory,memory-search,facts,graph}.ts` | 1 | delegate to store |
| `mcp-server/src/index.ts` | 1 | seam wiring (~L1649) |
| `agent/src/jobs/cron/{memory-lifecycle,ttl-cleanup}.ts` | 1 | call store methods |
| `shared/src/dgraph-memory-store.ts` | 2 | NEW Dgraph impl |
| `scripts/migrate/backfill-memory-to-dgraph.{ts,sh}` | 3 | NEW backfill + gates |
| `shared/src/shadow-memory-store.ts` | 4 | NEW shadow wrapper |
| `terraform/modules/gke-mcp/agent-helm/values.yaml` | 5 | `LORE_MEMORY_BACKEND` env |
| `terraform/modules/gke-mcp/dgraph-helm/`, `external-secrets.tf` | deploy | NEW chart + ESO secret |
| `CLAUDE.md` | 1 | document the seam + backend |

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Silent retrieval divergence (the 60-day class) | Shadow soak + divergence metric; stores throw, never `return []`; `context-assembly.ts` per-section catch increments an error metric |
| HNSW recall differs (pgvector vs Dgraph) | Parity gate (top-K Jaccard) on real data; tune topK/HNSW before flip; shared ranking keeps RRF identical |
| Keyword semantics shift (ILIKE → stemmed fulltext) | `term` index fallback; tested query-by-query |
| Lost writes at cutover | Incremental backfill to flip + scoped reverse mirror-write during rollback window |
| Contradiction/temporal-invalidation drift | Parity tests with identical fixtures across both stores |
| ACL/credential misconfig | Least-privilege runtime user; ESO + WI; guardian confined to bootstrap Job |
| Dgraph outage | `/admin/export` to GCS + Postgres `memory.*` read-only for N weeks |
| Performance regression | p95 gate in shadow phase; resources sized from the small footprint |

## Testing Strategy

- **Pure unit tests** (real values, no mocks): `rrfMerge`,
  `computeTransferScore`, `scoreImportance`, `parseFacts`,
  `parseGraphExtraction` — characterized before extraction, green after.
- **Store parity tests**: shared expectation fixtures run against both
  `PostgresMemoryStore` (real local Postgres) and `DgraphMemoryStore`
  (real local Dgraph container) — guarantees behaviour parity by
  construction.
- **Backfill test**: seed real Postgres, export to real Dgraph, assert
  xid/embedding/relationship preservation + idempotent re-run.
- **Shadow test**: primary result returned even when shadow throws;
  divergence metric emitted; error logged not swallowed.
- **Schema applier test**: run `setup-memory-dgraph-schema.sh` twice —
  second run is a no-op.

## ADR Reference

Extends [ADR-014: passive memory capture](../../adrs/ADR-014-passive-memory-capture.md)
and the hippo-memory lifecycle work. A follow-up ADR should record the
storage-engine decision (Dgraph for memory; Postgres retained for
everything else) and the `MemoryStore` seam as the portability hedge.
