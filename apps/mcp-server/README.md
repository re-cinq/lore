# Lore MCP Server (`@re-cinq/lore-mcp`)

Serves org context, ADRs, memory, and search to Claude Code over the
[Model Context Protocol](https://modelcontextprotocol.io). This is the single
entrypoint developers connect to: it auto-detects the current repo from the git
remote and serves that repo's context.

## Transports

Dual transport, selected by the `MCP_TRANSPORT` env var:

- **stdio** (default) — local mode. Runs on the developer's machine and proxies
  most operations to the GKE backend via `LORE_API_URL`.
- **http** (Streamable HTTP) — the shared server on GKE, talking directly to
  PostgreSQL when `LORE_DB_HOST` is set.

## What it serves

The three core tools — `lore_assemble_context`, `lore_search_context`,
`lore_search_memory` — plus 30+ others spanning memory, the task pipeline,
repo onboarding, spec-trace, and usage. Context is assembled from PostgreSQL +
pgvector (hybrid vector + BM25 search via Reciprocal Rank Fusion) using the YAML
templates in [`templates/`](./templates). For the full per-tool reference —
parameters, returns, and disambiguation — see
[`docs/mcp-tools-reference.md`](../../docs/mcp-tools-reference.md).

Task **CRUD** lives here; task **processing** is the Floor's job
(`@re-cinq/lore-floor`). All `/api/*` routes enforce bearer-token auth before
dispatch; errors are returned as text in MCP responses, never thrown.

## Layout

```
src/
  index.ts           entry: init OTEL → DB pool → load task types + templates → build server → start transport
  server/            build-mcp-server.ts, http-server.ts, transports.ts
  mcp/tools/         MCP tool implementations (context, memory, pipeline, repo, usage, spec-trace, local-runner)
  api/               routes.ts + routes/  — the HTTP API surface (ingest, webhooks, tokens, coverage, trace, ...)
  features/          domain logic
    context/             context assembly, hydration, transfer scoring
    memory/              facts, graph, memory store + search
    pipeline/            task config, CRUD, local runner
    repo/                repo detection, onboarding, deterministic lint/typecheck validation
    dark-factory/        settings schema + CODEOWNERS-approval authZ
    spec-trace/          spec→test trace ingest + query
  platform/          otel, db, session-tracker
templates/           YAML context-assembly templates (default, implementation, research, review)
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

Built into a container via [`Dockerfile`](./Dockerfile) and deployed to the
`mcp-servers` namespace on GKE (Streamable HTTP transport). The local install
path (`scripts/install.sh`) configures Claude Code to launch the stdio build,
which proxies to this backend. See [`infra/`](../../infra) and the root README.
