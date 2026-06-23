# Research: the actual local↔remote dependency line

Read-only reconnaissance before moving any code (Phase 1 prep). Findings
materially de-risk the split: the codebase already separates *logic* from the
*heavy value-dependencies* via pool injection + type-only imports.

## Heavy deps: where they are actually value/dynamically imported

`grep` for value imports (excluding erased `import type`) and dynamic
`import()` of the heavy packages across `apps/mcp-server/src`:

| Heavy dep | Imported (value/dynamic) in | In the local tool path? | Disposition |
|---|---|---|---|
| `pg` | `index.ts` only (`import pg` to build the pool) | No — boot wiring | Local `index.ts` builds no pool → **pg gone from local** |
| `octokit` / `@octokit/auth-app` | `platform/github-client.ts`, `features/dark-factory/dark-factory-authz.ts` | No | Move to `apps/lore-api` |
| `@google-cloud/storage` | `mcp/tools/pipeline-tools.ts` (dynamic, log reads); `api/routes/logs.ts`; `features/repo/repo-validation-cli.ts` | **Yes — pipeline-tools** | Proxy log reads → GCS gone from local |
| `tree-sitter*` / `web-tree-sitter` | `features/repo/repo-validation-cli.ts` (+ via `@re-cinq/lore-shared`) | No | Move to `apps/lore-api` |
| `@opentelemetry/sdk-node` + exporters | `platform/otel.ts` (`initOtel`) | **Yes — via otel.ts** | Split otel: light helpers → server-core; SDK init → lore-api |

Everywhere else `pg` appears it is `import type { Pool }` — erased at compile,
**not** a runtime dependency: `platform/db.ts`, `features/pipeline/pipeline.ts`,
`features/context/cross-repo.ts`. These modules are pool-*injected*: callers pass
a `Pool`; the module never constructs one. So they are portable and light.

## Consequence: Phase 1 is a carve, not a fused-module split

The old plan's T005 ("split feature modules that fuse proxy + DB code") is mostly
**unnecessary**. The pool-injected design already did that separation. The real
Phase 1 work is:

1. **Carve `libs/server-core`** = the pool-injected logic + light helpers the
   local tools import: `repo/repo-detect`, `memory/*` (memory, memory-search,
   memory-file, facts, graph), `context/context-assembly`, `context/cross-repo`,
   `spec-trace/query-trace`, `pipeline/pipeline-config` + `tasks` + `pipeline`
   CRUD, `platform/{agent-id, proxy-cache, session-tracker, anthropic-client}`,
   the pool-injected search fns in `platform/db.ts`, and the **light** otel
   helpers. All type-only `pg` / no heavy value deps.
2. **Split `platform/otel.ts`.** The local tools consume only `traceTool` /
   `traceRetrieval` (and the server uses `traceHttp`) — all built on
   `@opentelemetry/api` (light; a no-op when no SDK is initialized). The heavy
   `initOtel()` / `shutdownOtel()` (NodeSDK + gRPC/Cloud exporters + lazy
   `sdk-metrics`) stays in `apps/lore-api` boot. Local imports the light helpers,
   never calls `initOtel`, and tracing is a silent no-op. Local keeps only
   `@opentelemetry/api`.
3. **Proxy the GCS log-reads.** `pipeline-tools.ts` dynamically imports
   `@google-cloud/storage` to read task/job logs. REST endpoints already exist —
   `GET /api/task-logs`, `GET /api/job-run-logs` (`api/routes/logs.ts`) — so the
   local tool proxies to `LORE_API_URL` instead of hitting GCS directly. Removes
   `@google-cloud/storage` from the local tree.
4. **Proxy the onboard tool.** `repo-tools.ts` imports `onboardRepo` /
   `getOnboardedReposWithCounts` from `features/repo/repo-onboard.ts`, which
   value-imports `platform/github-client.ts` (octokit). Both are called with
   `getPool()!` — they already require a DB pool the local adapter never has, so
   in local mode they must proxy to the existing `POST /api/onboard` (the same
   pattern `repo-tools` already uses for `/api/ingest`). Removes `octokit` from
   the local tree. (`repo-onboard` + `github-client` are remote-only → lore-api.)
5. **Relocate `ProxyResult`.** `query-trace.ts` does `import type { ProxyResult }
   from mcp/tools/deps.js` — type-only (erased), but a backwards package edge.
   Move `ProxyResult` into server-core's proxy module; `deps.ts` re-imports it.
6. **Two entrypoints.** Local `index.ts`: build MCP server, connect stdio, no
   pool, no pg. Remote `index.ts`: `initOtel`, build pg pool + inject, load
   config/templates, `startHttpServer`.

### The three local→heavy entanglements (all resolved above)

| local tool | reaches heavy via | fix |
|---|---|---|
| context/memory/deps | `otel.ts` → `@opentelemetry/sdk-node` | split otel (helpers light) |
| `pipeline-tools` | dynamic `@google-cloud/storage` | proxy `/api/task-logs`,`/api/job-run-logs` |
| `repo-tools` | `repo-onboard` → `github-client` (octokit) | proxy `/api/onboard` |

## Heavy modules that move to `apps/lore-api` (remote-only)

Not in the local tool path; they carry the heavy value deps:
`platform/github-client.ts`, `platform/db.ts` pool construction,
`features/dark-factory/dark-factory-authz.ts`, `features/spec-trace/ingest.ts`
(tree-sitter), `features/repo/repo-validation-cli.ts`, `api/routes/logs.ts`
(GCS), and the entire `api/routes/**` + `server/http-server.ts`.

## The MCP tools are local-only

The remote app serves REST only — it never builds an `McpServer` (today, http
mode builds the server but never connects a transport; the split deletes that
dead branch). So `mcp/tools/**` + `server/build-mcp-server.ts` live in
`apps/mcp-server` alone. Their direct-DB branches (`getPool().query(...)`) are
guarded by a non-null pool and become dead-but-harmless in local (pool always
null); they pull no `pg` value dep (pool is injected), so they can stay as-is or
be trimmed later without affecting the leanness goal.
