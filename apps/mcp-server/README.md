# Lore MCP Server (`@re-cinq/lore-mcp`)

Serves org context, ADRs, memory, and search to Claude Code over the
[Model Context Protocol](https://modelcontextprotocol.io). This is the single
entrypoint developers connect to: it auto-detects the current repo from the git
remote and serves that repo's context.

## Transport

Single **stdio** transport (ADR-032). The MCP server runs on the developer's
machine, registered by `scripts/install.sh`, and speaks the MCP protocol to
Claude Code over stdio. It holds no database pool: it auto-detects the current
repo from the git remote and **proxies** every data operation to the shared
backend over `LORE_API_URL` (bearer `LORE_INGEST_TOKEN`), with a `~/.lore` file
fallback for a subset of memory tools. Proxied reads pass through a read-through
cache; writes invalidate the caches they affect. The remote backend it talks to
is `@re-cinq/lore-api`, a plain REST service that owns the direct PostgreSQL +
pgvector access behind `/api/*`.

## What it serves

The three core tools — `lore_assemble_context`, `lore_search_context`,
`lore_search_memory` — plus 30+ others spanning memory, the task pipeline,
repo onboarding, spec-trace, and usage. Context is assembled from PostgreSQL +
pgvector (hybrid vector + BM25 search via Reciprocal Rank Fusion) using the YAML
context-assembly templates that ship with `@re-cinq/lore-server-core`. For the
full per-tool reference —
parameters, returns, and disambiguation — see
[`docs/mcp-tools-reference.md`](../../docs/mcp-tools-reference.md).

Task **CRUD** lives here; task **processing** is the Floor's job
(`@re-cinq/lore-floor`). All `/api/*` routes enforce bearer-token auth before
dispatch; errors are returned as text in MCP responses, never thrown.

## Layout

```
src/
  index.ts           entry: load task types + templates → build the MCP server → connect the stdio transport
                     (no DB pool, no OTEL SDK — those heavy remote concerns live in @re-cinq/lore-api)
  server/            build-mcp-server.ts — assembles the server and registers every tool
  mcp/tools/         MCP tool implementations + registration (context, memory, pipeline, repo, usage,
                     spec-trace, local-runner); deps.ts holds the lazy getPool + proxy helpers
  features/          local-only glue — context (hydration, transfer scoring), pipeline (CRUD + local
                     runner), spec-trace; the bulk of the domain logic lives in @re-cinq/lore-server-core
                     and @re-cinq/lore-shared
  platform/          healthz + secret-redaction checks
```

## Develop

```bash
npm install                        # from the repo root (workspace member)
npm run build -w @re-cinq/lore-mcp
npm test  -w @re-cinq/lore-mcp     # unit tests (vitest)
```

Depends on `@re-cinq/lore-shared` — build it first, or use the root
`npm run build`. For the full local stack run `npm start` from the repo root;
the MCP server then listens on `:3001`.

## Deploy

There is no separate server deployment for this package — it runs locally over
stdio. `scripts/install.sh` builds the `@re-cinq/lore-shared`,
`@re-cinq/lore-server-core`, and `@re-cinq/lore-mcp` workspaces and configures
Claude Code to launch `apps/mcp-server/dist/index.js`, which proxies to the
shared backend. The remote piece that runs on GKE is `@re-cinq/lore-api`; see
[`infra/`](../../infra) and the root README.
