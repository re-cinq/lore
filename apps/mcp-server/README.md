# Lore MCP Server (`@re-cinq/lore-mcp`)

Serves org context, ADRs, memory, and search to Claude Code over the
[Model Context Protocol](https://modelcontextprotocol.io). This is the single
entrypoint developers connect to: it auto-detects the current repo from the git
remote and serves that repo's context.

## Transports

The same server (`buildMcpServer` — one tool registry) runs behind **two**
transports; `src/index.ts` picks one at boot from `LORE_MCP_HTTP`.

### stdio — the developer machine (default)

The MCP server runs on the developer's machine, registered by
`scripts/install.sh`, and speaks the MCP protocol to Claude Code over stdio. It
holds no database pool: it auto-detects the current repo from the git remote and
**proxies** every data operation to the shared backend over `LORE_API_URL`
(bearer `LORE_INGEST_TOKEN`), with a `~/.lore` file fallback for a subset of
memory tools. Proxied reads pass through a read-through cache; writes invalidate
the caches they affect. The remote backend it talks to is `@re-cinq/lore-api`, a
plain REST service that owns the direct PostgreSQL + pgvector access behind
`/api/*`.

### HTTP gateway — `lore-mcp`, for agent pods

With `LORE_MCP_HTTP=1` the same server mounts the MCP SDK's
`StreamableHTTPServerTransport` on a port instead of stdio
(`src/server/http-transport.ts`). This is the shared **`lore-mcp` gateway**: one
HTTPS service that gives headless agent pods (implementation / review / …) live
Lore tools _during_ a run, reached declaratively through their `AgentDefinition`
recipe's `resources.mcp_servers` entry (ADR-030/031/032). It proxies to
`lore-api` exactly like the stdio adapter.

| Env var | Meaning |
|---------|---------|
| `LORE_MCP_HTTP=1` | Serve over HTTP instead of stdio. |
| `LORE_MCP_PORT` | Listen port (default `8080`). |
| `LORE_MCP_AUTH_TOKEN` | Require `Authorization: Bearer <token>` on every request. Unset ⇒ auth off (local dev only). |
| `LORE_MCP_SERVER_MODE=agent` | Omit the laptop-only tools **and** `lore_create_pipeline_task` — context / memory / search / graph only. |
| `LORE_API_URL` | The `lore-api` base the gateway proxies to. |

**Endpoints:** `POST /mcp` (send `initialize` first; subsequent tool calls carry
the returned `mcp-session-id` header), `GET`/`DELETE /mcp` (stream / close a
session), and `GET /healthz`. **Hardening:** bearer auth on every `/mcp`
request; request bodies capped at 1 MB (`413` over the cap); malformed JSON →
`400`; the per-session server map is bounded (oldest evicted) so a dropped
connection can't leak it. The gateway also serves the (unauthenticated)
agent-skills registry at `/skills/*` (`src/server/skills-registry.ts`) — not
part of MCP; the ai-agent-subsystem init fetches it.

Run it locally:

```bash
LORE_MCP_HTTP=1 LORE_MCP_PORT=8080 LORE_MCP_AUTH_TOKEN=dev-token \
  LORE_API_URL=http://localhost:3000 node apps/mcp-server/dist/index.js
# → [lore] MCP HTTP gateway listening on :8080 (mode=full, auth=on)
curl -s localhost:8080/healthz   # → ok
```

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
  features/          local-only glue — context (transfer scoring), pipeline (CRUD + local
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
the MCP HTTP gateway then listens on `:3002` (`:3001` is `lore-api`, the
backend it proxies to).

## Deploy

**Local (stdio):** `scripts/install.sh` builds the `@re-cinq/lore-shared`,
`@re-cinq/lore-server-core`, and `@re-cinq/lore-mcp` workspaces and configures
Claude Code to launch `apps/mcp-server/dist/index.js`, which proxies to the
shared backend. Most developers only ever run this mode.

**Cluster (HTTP gateway):** the same image runs as the `lore-mcp` gateway for
agent pods — built by `.github/workflows/build-mcp-server.yml`
(`ghcr.io/re-cinq/lore-mcp`) and deployed by the `lore-mcp-helm` subchart of the
`lore-platform` umbrella into the `lore-api` namespace, with a public `:443`
Ingress owned by Terraform (`infra/terraform/lore-mcp.tf`, host from
`lore_mcp_url`). Agent recipes point at it via `resources.mcp_servers` seeded by
the ai-agents catalog; the entry is omitted until `lore_mcp_url` is set, so the
gateway is inert until deployed. The remote REST backend both transports proxy
to is `@re-cinq/lore-api`; see [`infra/`](../../infra) and the root README.
