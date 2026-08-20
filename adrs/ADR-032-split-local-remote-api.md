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
   `memory-file` fallback, template loading, and the wire/proxy schemas. It
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

4. **Fold the light logic into `@re-cinq/lore-shared`.** Rejected: mixing
   server-runtime glue into `lore-shared` risks pulling runtime concerns into a
   library other packages depend on. A dedicated `server-core` keeps the boundary
   legible. *(Amended 2026-08: this described `lore-shared` as "pure helpers
   (commit-trailers, settings types)". It is not, and was already not — it carries
   the whole `project/*` port tree and, since the data-model consolidation, 32
   table models. The rejection stands on the boundary argument alone; the
   purity claim was never load-bearing and is now simply wrong.)*

## Amendment (2026-08): `apps/mcp-server` gains a third deployable shape — the HTTP gateway

Decision 1 cast `apps/mcp-server` as **local-only** (the stdio MCP adapter on a developer laptop). It
now also runs as a **shared cluster deployable**: the `lore-mcp` gateway that serves agent pods their
live Lore tools over MCP-over-HTTP. Same code, same `buildMcpServer`, a new transport — `LORE_MCP_HTTP=1`
mounts the SDK's `StreamableHTTPServerTransport` instead of stdio, and `LORE_MCP_SERVER_MODE=agent`
omits the laptop-only + task-creating tools. The two runtime shapes of `apps/mcp-server` are therefore:

1. **Local stdio adapter** — one per developer, proxies to `lore-api` over HTTPS (unchanged).
2. **`lore-mcp` HTTP gateway** — one cluster Deployment (chart `charts/lore-mcp-helm`, image
   `ghcr.io/re-cinq/lore-mcp`) in the `lore-api` namespace, bearer-authed, public `:443` for agent pods.
   The Helm chart/Deployment/Service are named **`lore-mcp-gateway`**, not `lore-mcp`: the umbrella
   release still stores an orphaned `lore-mcp:` values block from the pre-rename remote workload
   (`namespace: mcp-servers`, now gone), and a subchart named `lore-mcp` would inherit it under
   `reuse_values` and deploy into the vanished namespace. The public host stays `lore-mcp.…`.

This does not violate the split's "names stop lying" goal: unlike `lore-api` (plain REST), the gateway
genuinely **speaks MCP** — so the `lore-mcp` name is honest. `lore-api` stays the REST backend both
shapes proxy to.

## Amendment (2026-08): `lore-api` owns every REST read — the Floor serves none

Decision 2 made `apps/lore-api` **the** remote HTTPS REST API. The Floor was never
meant to be a second one. It became one anyway: it now serves six read-only
endpoints — run-event history, turn transcripts by run and by task, conversation
fetch/save, assembly-run reads plus the catalog, and definition-by-name — because
that is where the code writing those tables happened to live. Proximity to the
writer is not a reason to host a reader.

**The rule, restated so it can be enforced:** `/api/*` reads are served by
`lore-api`, one folder per endpoint under `apps/lore-api/src/api/routes/`. A route
may live on the Floor only if it needs one of the Floor's three exclusive powers
([ADR-024](./ADR-024-ubiquitous-language-execution-model.md), amendment 2026-08).
Today exactly four qualify:

| Floor route | Which power |
|---|---|
| `POST /api/webhook/github` | feeds the drain loop directly — relocating it buys a hop and a failure mode |
| `POST /api/agent-events` (NDJSON sink) | publishes to the in-process SSE bus |
| `GET /api/agent-events/stream/{id}` | subscribes to that same bus — welded to the sink until PG `LISTEN`/`NOTIFY` |
| `GET /api/agent-logs/{name}` | reads pod logs through the Kubernetes API |

Everything else on the Floor's hapi server is a squatter and moves.

The ingest ingress is the awkward case worth naming: `POST /api/webhook/ci-tests`
and the graph-ingest route sit on the Floor while `POST /api/repos/:o/:r/ingest-graph`
already sits on `lore-api`, so the same conceptual surface is split across both
deployables by accident of history. Both Floor routes only map a payload onto a
`pipeline.events` row, which any process holding the database can do. They belong
next to their sibling on `lore-api` — with the caveat that moving them repoints
every onboarded repo's CI workflow and the `lore-code-trace` binary's default
target, so it wants a deprecation window serving both hosts rather than a cutover.

This changes no contract: same paths, same auth, same body limits, same status
codes. It is the same structural argument the original split made, applied to the
deployable that grew a REST API after the fact.

## Amendment (2026-08): where a type lives

Decision 3 says `server-core` holds "shared schemas and types", and alternative 4
called `lore-shared` "pure helpers". Neither reading survives contact with the
code, and the ambiguity between them is what invites a shape being declared in
both. The line:

- **A persisted data model** — the shape of a table — lives in
  `libs/shared/src/models/`, one file per entity, carrying a schema, the type
  inferred from it, and the map binding each field to its column. Adapters build
  their SELECT lists from that map; API contracts derive their stored fields from
  it. One declaration reaches from the column to the generated client.
- **A wire or proxy schema** — the shape of a request the proxy forwards, or a
  response it parses — stays in `server-core`, which is where the proxy path
  lives.

One constraint is easy to violate and expensive to discover, so it is recorded
here rather than learned twice: **seven `lore-shared` modules are reachable by
`apps/web-ui` through a relative file path**, because web-ui cannot import the
package at all. Everything in that import graph must exist in web-ui's own
lockfile. Adding `zod` to one of them — via a model re-export — broke both the
web-ui parity suite and the Next build, and the failure names a missing package
rather than the boundary it crossed. Those modules keep plain TypeScript types;
where a model must agree with one, the MODEL imports the plain type and asserts
equivalence, so the dependency runs one way only.
