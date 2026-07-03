# Lore API (`@re-cinq/lore-api`)

The remote **REST backend** — a plain HTTPS API serving every `/api/*` route on
GKE. It owns the data-plane work (PostgreSQL + pgvector, GitHub, GCS,
tree-sitter); the local stdio MCP adapter (`@re-cinq/lore-mcp`) holds no database
and proxies to these routes. This is **not** an MCP server — it speaks HTTP, not
the Model Context Protocol. See [ADR-032](../../adrs/ADR-032-split-local-remote-api.md)
for the local/remote split and [ADR-033](../../adrs/ADR-033-lore-api-hapi.md) for
the HTTP framework.

## HTTP framework

Runs on **hapi** (`@hapi/hapi`), the same framework as `apps/floor` (ADR-033).
A single `buildServer(getPool)` factory constructs the server — shared by
production boot and the tests (`inject`). Cross-cutting concerns are hapi
plugins rather than per-handler plumbing:

- **`server/plugins/bearer-scope.ts`** — a custom auth scheme wrapping
  `resolveTokenScopes`. Routes declare their scope via `bearerScope("read"|"write"
  |"task"|"webhook"|"admin")`; `admin` grants all; the `LORE_INGEST_TOKEN`
  full-access fallback is preserved. Webhook routes verify their own HMAC and set
  `auth: false`.
- **`server/plugins/rate-limit.ts`** — an `onPreAuth` sliding-window limiter
  (webhook 30 / task 60 / default 200 per minute; `/healthz` exempt;
  429 + `Retry-After: 60`).
- **`server/plugins/tracing.ts`** — one OTel span per request plus the `traceHttp`
  request/latency metrics.

Body validation stays on **zod** (no joi). The server-default body cap is 1 MB
(`payload.maxBytes`); write routes read the raw body via `server/raw-body.ts`.

## Layout

```
src/
  index.ts           entry: init OTEL → DB pool → buildServer().start()
  server/            build-server.ts (the one factory), http-server.ts, raw-body.ts
    plugins/           bearer-scope · rate-limit · tracing
  api/
    routes.ts          barrel re-exporting the post-ingest agent triggers
    routes/            native hapi routes, one folder per domain:
                       infra (healthz, dist) · repos · context · graph
                       tasks (get/list/by-pr/timeline/logs/post) · memory
                       ingest · webhooks · tokens · dark-factory
                       agent-definitions · impact · trace · features
  features/          domain logic (webhook, dark-factory, agents, ...)
  platform/          otel, db, github-client, project-boot
  integration-tests/ real-server + real-proxy round-trip (Postgres-backed)
```

Routes are registered by `server/build-server.ts`; hapi resolves them by
specificity and rejects conflicting registrations (no load-bearing route
ordering). Each handler returns a value — hapi serializes it and sets headers.

## Develop

```bash
npm install                          # from the repo root (workspace member)
npm run build -w @re-cinq/lore-api
npm test  -w @re-cinq/lore-api       # unit tests (vitest)

# Integration suite (needs Postgres):
npm run db:up                        # from the repo root
npx vitest run --config vitest.integration.config.ts   # from apps/lore-api
```

Depends on `@re-cinq/lore-shared` and `@re-cinq/lore-server-core` — build those
first, or use the root `npm run build` which orders them. For the full local
stack run `npm start` from the repo root; lore-api then listens on `:3001`.

## Deploy

Built into a container via [`Dockerfile`](./Dockerfile) and shipped as the
`lore-api` Service (port 3000) in the `lore-api` namespace, part of the
`lore-platform` umbrella Helm chart. Image `ghcr.io/re-cinq/lore-api`, built and
pushed by [`.github/workflows/build-lore-api.yml`](../../.github/workflows/build-lore-api.yml)
on changes to `apps/lore-api/**` or the bundled libs. Keeps `LORE_DB_HOST` and
its DB secret. The `POST /api/webhook/github` ingress lives on the **Floor**, not
here. See [`infra/`](../../infra) and the root README.
