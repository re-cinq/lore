# Lore Server Core (`@re-cinq/lore-server-core`)

The **light shared core** of the local/remote split
([ADR-032](../../adrs/ADR-032-split-local-remote-api.md)): the business logic
imported by both deployables — `apps/mcp-server` (the lean local stdio MCP
adapter, which also runs as the `lore-mcp` HTTP gateway) and `apps/lore-api`
(the heavy remote REST backend). It exists so the local install can share real
logic with the server **without inheriting the server's dependency tree**: this
package, not folder layout, is where ADR-032's leanness win is enforced.

The root barrel (`src/index.ts`) re-exports the proxy client; everything else
is reached via subpath exports, e.g.
`@re-cinq/lore-server-core/features/memory/memory.js`.

## What lives here

- **`src/proxy.ts`** — the **API proxy client** the MCP adapter calls lore-api
  through. `ProxyResult` distinguishes `not_configured` (file fallback is fine)
  from `unreachable` (loud failure) from `denied` (401/403 — never served from
  stale cache). Read caching in `src/platform/proxy-cache.ts`.
- **`src/features/memory/`** — memory, memory search, facts, graph, and the
  `~/.lore/memory/` file fallback (`memory-file.ts`).
- **`src/features/context/context-assembly.ts`** — context assembly. The
  retrieval engine itself is single-sourced in `@re-cinq/lore-shared`
  (`project/knowledge/context-assembly`) and re-exported here; what this
  package *owns* is the YAML templates in [`templates/`](./templates)
  (`default`, `review`, `implementation`, `research`) plus
  `loadDefaultTemplates()`, which both apps call at boot. Cross-repo context
  filtering in `cross-repo.ts`.
- **`src/features/pipeline/`** — pipeline task CRUD policy (trust-level gate,
  default repo, retry, review-iteration) over the policy-free CRUD re-exported
  from `@re-cinq/lore-shared`.
- **`src/features/repo/repo-detect.ts`** — detects the current `owner/repo`
  from the git remote.
- **`src/features/spec-trace/query-trace.ts`** — the trace-graph query logic
  behind the `query_trace` MCP tool.
- **`src/platform/`** — `otel.ts` (**trace/metric helpers on
  `@opentelemetry/api` only** — no-ops until the remote app registers an SDK),
  `tracing.ts` (optional Langfuse search tracing), `session-tracker.ts` (passive session tracking: tool-call ring buffer, dumped
  to `~/.lore/last-session.json` on exit), `db.ts` (RRF hybrid search),
  `agent-id.ts`, `anthropic-client.ts` (graph-extraction call via the shared
  `Llm` singleton).

## The boundary: what it must stay free of

The MCP adapter's install is lean only if this package is. Its runtime
dependencies are exactly: `@re-cinq/lore-shared`, `@opentelemetry/api`, `glob`,
`yaml`, `zod`. It **must not** depend on `pg`, `octokit`,
`@google-cloud/storage`, `tree-sitter*`, or the OTel SDK/exporters (ADR-032
decision 3).

The DB-facing modules (`platform/db.ts`, `features/pipeline/pipeline.ts`,
`features/memory/*`) still compile against Postgres — via **type-only imports**
(`import type { Pool } from "pg"`; `@types/pg` is a devDependency) and an
injected pool (`setPool()`), wired only by `apps/lore-api` at boot. In the
local adapter those paths are never configured and the proxy/file fallbacks
take over. Heavy vendor clients stay behind `@re-cinq/lore-shared`'s narrow
subpath exports and never enter this package's import graph.

## Relation to `libs/shared`

`@re-cinq/lore-shared` is the org-wide library (Project facade ports, the 32
table models, LLM abstraction, pure helpers) used by *every* service — Floor,
stations, lore-api, mcp-server. `server-core` is narrower: **server-runtime
glue shared by exactly the two ADR-032 deployables** — the proxy path, wire and
proxy schemas, template loading, session tracking. The line (ADR-032, 2026-08
amendment): a persisted table shape lives in `libs/shared/src/models/`; a wire
or proxy schema stays here, where the proxy path lives.

## Develop

```bash
npm install                                  # from the repo root (workspace member)
npm run build -w @re-cinq/lore-server-core   # tsc → dist/
npm test  -w @re-cinq/lore-server-core       # vitest
```

Depends on `@re-cinq/lore-shared` — build it first, or use the root
`npm run build` which orders them. Not deployed on its own: it ships inside the
`lore-api` and `lore-mcp` images.
