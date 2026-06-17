# Tasks: Local Read-Through Cache

Spec: [spec.md](spec.md)

## Phase 0 — Remove dead `/mcp` (prerequisite cleanup)

- [x] T001 Remove the dormant, unauthenticated `/mcp` route + Streamable-HTTP transport from `apps/mcp-server/src/server/http-server.ts` (keep `/api/*`); drop the now-unused `server` arg through `transports.ts`
- [x] T002 [P] Update/trim any http-server test to assert `/mcp` is gone and `/api/*` still serves — N/A, no http-server test existed

## Phase 1 — Cache core

- [ ] T003 New `apps/mcp-server/src/platform/proxy-cache.ts`: key builder (sha256 of tool+canonical args+repo), TTL read (`readFresh`/`readAny`), `store`, `invalidate(tools, repo?)`, LRU + TTL eviction, `markFresh`/`markStale`, config/env loading (`LORE_CACHE_ENABLED`, `LORE_CACHE_DIR`, `max_entries`, `ttl_overrides`)
- [ ] T004 [P] Tests `apps/mcp-server/src/platform/proxy-cache.test.ts`: TTL fresh/expired, LRU cap, stale-serve, invalidation, key stability across arg order, repo isolation, disabled-mode no-op

## Phase 2 — Wire reads through the cache

- [ ] T005 Add `withReadCache(policy, doProxy)` helper in `apps/mcp-server/src/mcp/tools/deps.ts` (fresh hit short-circuits; on `ok` store; on `unreachable` serve labeled stale if present)
- [ ] T006 `lore_assemble_context` (context-tools.ts) routes its local-mode fetch through `withReadCache`
- [ ] T007 Memory reads (`search_memory`, `read_memory`, `list_memories`) + `query_graph` (memory-tools.ts) wrapped with `withReadCache`
- [ ] T008 `lore-query-trace` (spec-trace-tools.ts) wrapped with `withReadCache`
- [ ] T009 `lore_get_task_logs` / `lore_get_job_logs` (pipeline-tools.ts) cached only when `complete: true`

## Phase 3 — Mutation invalidation

- [ ] T010 `write_memory` / `delete_memory` invalidate repo-scoped memory reads + `assemble_context`; `write_episode` invalidates `search_memory` + `query_graph` + `assemble_context` (memory-tools.ts)
- [ ] T011 `create_pipeline_task` invalidates cached task-list reads (pipeline-tools.ts); `ingest_files` invalidates `assemble_context` for the repo (repo-tools.ts)

## Phase 4 — Docs

- [ ] T012 [P] Update `docs/mcp-tools.md` with a "Cached?" column reflecting the policy

## Acceptance gate

- [ ] All 12 spec acceptance criteria pass
- [ ] `yarn tsc` + `yarn eslint` + `vitest run` green in `apps/mcp-server`
