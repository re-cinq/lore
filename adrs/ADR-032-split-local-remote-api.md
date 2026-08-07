---
adr_number: 32
title: "Split the local MCP adapter from the remote HTTP API into two deployables"
status: draft
date: 2026-06-23
domains: [mcp-server, api, infra, packaging, dx]
relates: "specs/split-local-remote-api/spec.md"
---

# ADR-032: Split the local MCP adapter from the remote HTTP API

This ADR splits the fused mcp-server into two deployables sharing a light core — a local-only stdio MCP adapter and a new remote lore-api HTTPS REST backend — so local installs drop remote-only dependencies like pg and tree-sitter, and the names stop calling a plain REST API "mcp".

## Context

The local stdio MCP adapter and the remote HTTPS REST backend are the **same
deployable**, `apps/mcp-server`. A single `index.ts` builds an `McpServer`, and
`server/transports.ts` chooses the runtime at boot from `MCP_TRANSPORT`:
`stdio` on a developer's machine, `http` for the GKE REST backend that the stdio
adapter proxies to.

This fusion taxes the people it should serve least — **developers running the
local adapter**. Because one `package.json` is the union of both runtimes,
every local install pulls remote-only freight it never executes:

- `pg` — the Postgres pool. Local mode runs with no DB (`LORE_DB_HOST` unset);
  it proxies to `LORE_API_URL` or falls back to `~/.lore` files.
- `octokit` + `@octokit/auth-app` — all GitHub operations are server-side.
- `@google-cloud/storage` — task-log persistence, remote-only.
- `tree-sitter-wasms` + `web-tree-sitter` — AST chunking for ingest, remote-only.
- the OTel gRPC + Cloud exporters — remote telemetry.

For the local adapter — which needs only the MCP SDK, `zod`, `yaml`, a proxy
client, and a slice of light logic — this is slower `npm install`, native-build
friction (`pg`, `tree-sitter`) on contributor laptops, and a wider attack
surface, all for code the process never runs.

A second defect is **naming honesty**. The remote surface is a plain HTTPS REST
API (`/api/*`) that speaks no MCP, yet carries the `mcp` name throughout:
package `@re-cinq/lore-mcp`, image, boot log `MCP server (HTTP REST API)
listening`, env `MCP_TRANSPORT`. Only the **local** adapter actually speaks the
MCP protocol; the name belongs to it alone.

A third, smaller issue: every REST handler sits flat in `api/routes/` — ~30
handler modules plus their tests in one directory.

## Decision

Split the one fused app into **two deployables that share a light core**, and
make the names tell the truth.

1. **`apps/mcp-server` becomes local-only** — the stdio MCP adapter. It keeps
   the `mcp` name because it *is* MCP. One entrypoint (stdio); no transport
   switch. Its `package.json` lists only light deps.

2. **`apps/lore-api` (new) is the remote HTTPS REST API** — `http-server.ts`,
   the `/api/*` routes, and the DB/Octokit/GCS/tree-sitter-backed feature
   implementations. One entrypoint (HTTP); no transport switch. It carries
   **no `mcp`** in package name (`@re-cinq/lore-api`), image, or boot log
   (`Lore API listening`).

3. **`libs/server-core` (new, `@re-cinq/lore-server-core`)** holds the light
   shared logic both apps import — `repo-detect`, the proxy HTTP client,
   `memory-file` fallback, template loading, shared zod schemas and types. It
   **must not** depend on `pg`, `octokit`, `@google-cloud/storage`,
   `tree-sitter*`, or the OTel gRPC exporters. This package, not the folder
   layout, is where the win is enforced: it draws the line between the proxy
   path (light, shared) and the DB implementation (heavy, remote-only).

4. **`MCP_TRANSPORT` is removed.** Each app has exactly one runtime, so the
   mode branch in `transports.ts` is deleted.

5. **Routes are reorganized one folder per HTTP endpoint.** Multi-endpoint
   modules (`webhooks.ts` → github/slack/incident; `tasks.ts` → list/get/post)
   are split; the dispatcher and shared `http`/`auth`/`helpers` stay at the
   `routes/` root.

6. **The rename reaches code- and user-facing names only.** Package, image,
   boot log, and `MCP_TRANSPORT` change now. Infra-internal identifiers — the
   terraform module `gke-mcp`, the Helm chart dir `mcp-helm`, the filename
   `lore-mcp.tf` — are **kept**; only their *contents* change (drop
   `MCP_TRANSPORT`, retarget the image).

## Consequences

**Positive**

- The local install drops every remote-only dependency. Faster install, no
  native-build friction, smaller surface — the stated goal, enforced by
  `npm ls` in `apps/mcp-server` (spec SC-1).
- Names stop lying: the REST API is `lore-api`; MCP lives only where MCP is
  spoken.
- The two apps build, test, and deploy independently; a remote-only change can
  no longer perturb the local adapter's dependency tree and vice versa.
- Folder-per-endpoint routes make a route easy to find, own, and test.

**Negative / costs**

- A real refactor with infra blast radius: Dockerfile, Helm values, terraform,
  CI, and four dev scripts must retarget the new app names.
- **The hard part is drawing the dependency line.** Feature modules that fuse
  proxy + DB code (`features/pipeline/pipeline.ts`, `features/memory/memory.ts`)
  must be split so the local app bundles only the proxy path. This is delicate
  and is sequenced as its own phase (spec Phase 1) with the boundary proven via
  `npm ls` before any infra touches.
- Two `package.json`/`tsconfig`/test configs to maintain instead of one.

**Neutral**

- The REST contract is unchanged — same paths, auth, body limits, status codes
  (spec FR-4). This is structural, not behavioral.

## Alternatives considered

1. **Keep one app, tree-shake the local bundle.** Rejected: bundler tree-shaking
   does not stop `npm install` from resolving the union of deps, and the native
   `pg`/`tree-sitter` builds still run. It also leaves the `mcp` name on the
   REST API.

2. **Split within the one app (`src/local/` vs `src/remote/`).** Rejected: a
   single `package.json` still forces remote deps onto local installs — it
   tidies folders without delivering the leanness goal.

3. **Rename infra internals too (`gke-mcp`, `mcp-helm`, `lore-mcp.tf`).**
   Deferred, not rejected. Renaming a Helm release is an uninstall+reinstall on
   a live service; a terraform module rename churns state into destroy/recreate
   without `moved {}` blocks. Pure risk for zero functional gain, and it serves
   neither the leanness nor the naming-honesty goal a developer ever sees. A
   later, carefully-staged cutover can do it if desired.

   **Update (2026-06-30):** done as a follow-up once the pre-launch window made
   the namespace destroy/recreate free of user impact — the remote workload +
   namespace were renamed `lore-mcp`/`mcp-servers` → `lore-api`/`lore-api`
   (Helm chart `charts/mcp-helm/` → `charts/lore-api-helm/`; `lore-mcp.tf` had
   already been folded into the `lore-platform` umbrella). The `mcp` name now
   lives only on the local adapter (`@re-cinq/lore-mcp`). See branch
   `infra/rename-lore-api-workload` / spec Phase 8.

4. **Fold the light logic into `@re-cinq/lore-shared`.** Rejected: `lore-shared`
   is pure helpers (commit-trailers, settings types). Mixing server-runtime glue
   in risks pulling runtime concerns into a currently-pure lib. A dedicated
   `server-core` keeps the boundary legible.

## Amendment (2026-08): `apps/mcp-server` gains a third deployable shape — the HTTP gateway

Decision 1 cast `apps/mcp-server` as **local-only** (the stdio MCP adapter on a developer laptop). It
now also runs as a **shared cluster deployable**: the `lore-mcp` gateway that serves agent pods their
live Lore tools over MCP-over-HTTP. Same code, same `buildMcpServer`, a new transport — `LORE_MCP_HTTP=1`
mounts the SDK's `StreamableHTTPServerTransport` instead of stdio, and `LORE_MCP_SERVER_MODE=agent`
omits the laptop-only + task-creating tools. The two runtime shapes of `apps/mcp-server` are therefore:

1. **Local stdio adapter** — one per developer, proxies to `lore-api` over HTTPS (unchanged).
2. **`lore-mcp` HTTP gateway** — one cluster Deployment (chart `charts/lore-mcp-helm`, image
   `ghcr.io/re-cinq/lore-mcp`) in the `lore-api` namespace, bearer-authed, public `:443` for agent pods.

This does not violate the split's "names stop lying" goal: unlike `lore-api` (plain REST), the gateway
genuinely **speaks MCP** — so the `lore-mcp` name is honest. `lore-api` stays the REST backend both
shapes proxy to.
