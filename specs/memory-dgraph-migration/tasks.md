# Tasks: Memory → Dgraph Migration

Implements [`spec.md`](./spec.md) + [`data-model.md`](./data-model.md) +
[`plan.md`](./plan.md). Strict TDD — each task is red→green→refactor,
real values, **no mocks** (Dgraph tasks run against a real local
container). `[P]` = parallelizable with siblings. Test names use
tested-value + expected-outcome (no "should").

## Phase 0 — Dgraph up + schema

- [ ] T001 Add a `lore-dgraph` standalone container to `scripts/dev-local.sh` (publish `:8080`/`:9080`, bind-mount `.lore-dgraphdata`, health-probe `:8080/health`, ACL off locally). Idempotent create/start matching the `lore-postgres` block.
- [ ] T002 Write `scripts/infra/setup-memory-dgraph-schema.sh` applying the DQL type system + predicate/index defs from `data-model.md`. Invoke it from `dev-local.sh` after the container is healthy.
- [ ] T003 [P] Test: running `setup-memory-dgraph-schema.sh` twice leaves the schema unchanged (second run no-op); the HNSW + xid-upsert indexes are present.
- [ ] T004 Build `shared/src/dgraph-client.ts` — `dgraph-js` gRPC wrapper exposing `query(dql, vars)` + `mutate(upsertBlock)`; connection config from env.
- [ ] T005 [P] Test `shared/src/__tests__/dgraph-client.test.ts` against the real container — a trivial upsert then read round-trips.

## Phase 1 — Seam + PostgresMemoryStore (behavior-preserving)

- [ ] T010 RED: characterization tests for `rrfMerge`, `computeTransferScore`, `scoreImportance`, session diversification, `parseFacts`, `parseGraphExtraction` asserting current outputs on real inputs.
- [ ] T011 GREEN/REFACTOR: extract those into `shared/src/memory-ranking.ts` + `shared/src/fact-extraction.ts` verbatim; repoint `mcp-server/src/memory-search.ts` / `facts.ts` imports. Existing suites stay green.
- [ ] T012 Define `MemoryStore` interface + `setMemoryStore`/`memoryStore`/`selectMemoryStore` in `shared/src/memory-store.ts`. `selectMemoryStore` throws when the chosen backend's client is missing.
- [ ] T013 [P] Test `shared/src/__tests__/memory-store-select.test.ts` — `LORE_MEMORY_BACKEND=dgraph` with no Dgraph client throws; `=postgres` with no pool throws; defaults to postgres.
- [ ] T014 RED: `shared/src/__tests__/postgres-memory-store.test.ts` against real local Postgres — `writeMemory` then `readMemory` returns the value; re-write increments version + writes a `memory_versions` row + an audit row.
- [ ] T015 GREEN: `PostgresMemoryStore` delegates to the current `memory.ts` functions verbatim.
- [ ] T016 REFACTOR: move the SQL bodies from `memory.ts`/`memory-search.ts`/`facts.ts`/`graph.ts` into `PostgresMemoryStore` methods; the modules call `memoryStore()`. Existing `facts/graph/memory/routes/context-assembly` tests stay green.
- [ ] T017 Wire `setMemoryStore(selectMemoryStore(...))` in `mcp-server/src/index.ts` (~L1649); `isMemoryDbAvailable()` → `memoryStore().isAvailable()`; default `postgres`. Full suite green = seam landed with zero behaviour change.
- [ ] T018 [P] Repoint `agent/src/jobs/cron/memory-lifecycle.ts` + `ttl-cleanup.ts` to `memoryStore()` data-access methods (also fixes the `ttl_expires_at`/`deleted` column-name bug via `expireDueMemories`).

## Phase 2 — DgraphMemoryStore (against the real container)

Each task: RED (test asserting the SAME expectation as the Postgres-store
test, shared fixture) → GREEN (implement the DQL) → REFACTOR.

- [ ] T020 `writeMemory` / `readMemory` — version increments on re-write; latest-version read; specific + all-version reads via `Memory.versions`.
- [ ] T021 `deleteMemory` (soft) + `listMemories` (repo/agent scope, expiry + `is_deleted` filter, pagination, `has_facts` count, total).
- [ ] T022 `searchMemories` — 4-list multi-block DQL query; `rrfMerge` (shared) produces the same ranking as Postgres on a shared fixture; session diversification cap holds.
- [ ] T023 [P] Retrieval strengthening — fire-and-forget upserts bump `retrieval_count`/`last_retrieved_at`/`half_life_days` and revive stale→observed; never blocks the search.
- [ ] T024 `persistFact` + `invalidateContradictions` — cosine ≥ 0.92 over real 768-dim vectors invalidates the old fact (`active=false`, `valid_to`, `invalidated_by`) and writes a `FactConflict`.
- [ ] T025 [P] `writeEpisode` — `Episode.content_hash` `@upsert` dedup returns null on a duplicate.
- [ ] T026 `upsertEntity` (dedup on `name|type|repo`) + `upsertEdge` (exact-edge short-circuit; contradictory same-source-same-relation edges invalidated; provenance edges created).
- [ ] T027 `queryGraph` — `@recurse(depth, loop:false)` returns multi-hop neighbours, `active` edges only, cycle-safe; `relation_type` filter + repo scope honoured. Asserts depth>1 returns 2nd/3rd-hop entities a 1-hop query would miss.
- [ ] T028 [P] `neighbors` + `allEntityNames` (graph-augmentation support) parity with Postgres.
- [ ] T029 [P] `sharedWrite`/`sharedRead`, `createSnapshot`/`restoreSnapshot`, `agentHealth`/`agentStats`, `audit` parity.
- [ ] T030 Lifecycle data-access (`agentsOverMemoryCap`, `decayCandidates`, `softDeleteMemories`, `agentsOverFactCap`, `evictOldInvalidatedFacts`, `transitionStaleFacts`, `recentValidFacts`, `upsertConsolidatedMemory`) + `expireDueMemories` parity, with scoring still in `memory-ranking.ts`.

## Phase 3 — Backfill

- [ ] T040 RED: `scripts/migrate/__tests__/backfill-memory-to-dgraph.test.ts` — seed real Postgres with a few rows of each table; run the exporter against real Dgraph; assert UUID preserved as `xid`, 768-dim embeddings preserved, relationships resolve, second run is idempotent (counts unchanged).
- [ ] T041 GREEN: implement the two-pass xid-keyed exporter `scripts/migrate/backfill-memory-to-dgraph.ts` + `.sh` runner.
- [ ] T042 RED/GREEN: parity-verification step — `searchMemories` top-K Jaccard ≥ 0.8 between stores on seeded queries; embedding fidelity (dim==768, cosine(self)==1.0). Exporter exits non-zero on any gate failure.

## Phase 4 — Cutover machinery

- [ ] T050 RED: `shared/src/__tests__/shadow-memory-store.test.ts` — primary result returned even when shadow throws; `lore.memory.shadow_divergence` emitted; shadow error logged not swallowed.
- [ ] T051 GREEN/REFACTOR: implement `ShadowMemoryStore` + `LORE_MEMORY_SHADOW` wiring.
- [ ] T052 [P] Test: `context-assembly.ts` per-section catch increments an error metric when the memory store throws (no silent empty result).

## Phase 5 — Deploy (behind the green flag)

- [ ] T060 `terraform/modules/gke-mcp/dgraph-helm/` — zero+alpha StatefulSet + Services + PVC; validated via `helm template` render assertions.
- [ ] T061 [P] ACL bootstrap `pre-install` Job creating the scoped `lore-memory-app` user (read+write on memory predicates only); guardian used only here.
- [ ] T062 [P] `terraform/external-secrets.tf` — `ExternalSecret` for `lore-dgraph-credentials` via `gcp-secret-manager` + WI; assert no value hardcoded in the chart (`terraform plan` render check).
- [ ] T063 [P] `/admin/export` backup CronJob to a GCS bucket + lifecycle retention.
- [ ] T064 `terraform/modules/gke-mcp/agent-helm/values.yaml` — `LORE_MEMORY_BACKEND` (+ shadow) env; default `postgres`.

## Phase 6 — Verify + cutover + decommission

- [ ] T070 Typecheck clean across `shared/`, `mcp-server/`, `agent/`; full suites green with default backend.
- [ ] T071 Manual end-to-end locally: `LORE_MEMORY_BACKEND=dgraph npm start`; exercise `lore_write_memory`/`lore_search_memory`/`lore_query_graph` (incl. depth>1) against Dgraph with no Postgres `memory.*` access.
- [ ] T072 Run the backfill Job in staging; confirm parity gates pass (exit 0).
- [ ] T073 Enable `LORE_MEMORY_SHADOW=dgraph`; soak ~7 days; confirm divergence under threshold + counts equal after incremental backfill before flipping.
- [ ] T074 Flip `LORE_MEMORY_BACKEND=dgraph`; keep reverse mirror-write + Postgres `memory.*` read-only for the rollback window.
- [ ] T075 After a clean rollback window: drop the mirror-write, drop Postgres `memory.*`, revoke the `lore` grant on `memory`, remove `setup-memory-schema.sh` from the deploy path. Update `CLAUDE.md`.

## Phase 7 — Follow-ups (deferred)

- [ ] F-replica Add a 3-alpha replica group if data outgrows a single alpha.
- [ ] F-asof Expose temporal "as-of" graph queries (drop `active` filter, use `valid_from`/`valid_to` range) as an MCP parameter.
- [ ] F-pg-retire Decide the sunset date for `PostgresMemoryStore` (proposal: one rollback window + one quarter post-flip).
