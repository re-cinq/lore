# Feature Specification: Split Local MCP Adapter from Remote HTTP API

| Field    | Value                                                          |
|----------|----------------------------------------------------------------|
| Feature  | Split Local MCP Adapter ↔ Remote HTTPS REST API                |
| Status   | In Progress                                                    |
| Created  | 2026-06-23                                                     |
| Owner    | Platform Engineering                                          |
| ADR      | [ADR-032](../../adrs/ADR-032-split-local-remote-api.md)        |

This split separates the local stdio MCP adapter from the remote HTTPS REST backend into two deployables, so a developer's local install no longer pulls remote-only dependencies (pg, octokit, GCS, tree-sitter, OTel exporters) and the remote surface is renamed to reflect that it speaks REST, not MCP.

## Problem Statement

Today the local stdio MCP adapter and the remote HTTPS REST backend are the
**same deployable**, `apps/mcp-server`. One `index.ts` builds an `McpServer`,
and [`server/transports.ts`](../../apps/mcp-server/src/server/transports.ts)
picks the runtime at boot from `MCP_TRANSPORT`: `stdio` (a developer's machine)
or `http` (the GKE REST backend the stdio adapter proxies to).

That fusion costs the people it should serve least — **developers running the
local adapter**. `apps/mcp-server/package.json` carries the union of both
runtimes' dependencies, so every local install pulls remote-only freight it
never executes:

- `pg` — the Postgres pool. Local mode runs with no DB (`LORE_DB_HOST` unset);
  it proxies to `LORE_API_URL` or falls back to `~/.lore` files.
- `octokit` + `@octokit/auth-app` — GitHub operations happen server-side.
- `@google-cloud/storage` — task-log persistence, remote-only.
- `tree-sitter-wasms` + `web-tree-sitter` — AST chunking for ingest, remote-only.
- `@opentelemetry/exporter-*-otlp-grpc` + the Cloud exporters — remote telemetry.

The local adapter genuinely needs only the MCP SDK, `zod`, `yaml`, the proxy
client, and a slice of light business logic. Everything else is install weight,
slower `npm install`, a larger attack surface, and native-build friction
(`tree-sitter`, `pg`) on contributor laptops — for code the process never runs.

A second, smaller defect is **naming honesty**. The remote surface is a plain
HTTPS REST API (`/api/*`). It carries the `mcp` name everywhere — package
`@re-cinq/lore-mcp`, image, Helm chart `mcp-helm`, the boot log `MCP server
(HTTP REST API) listening`, env `MCP_TRANSPORT` — even though it speaks no MCP.
Only the **local** adapter actually speaks the MCP protocol. The name belongs to
the local side alone.

A third issue is **route-layer ergonomics**: every REST handler lives flat in
[`api/routes/`](../../apps/mcp-server/src/api/routes/) — ~30 handler modules and
their tests in one directory. Adding or finding a route means scanning a wall of
sibling files.

## Solution

Split the one fused app into **two deployables that share a light core**, and
let names tell the truth.

### Target topology

```
apps/
  mcp-server/        # LOCAL ONLY — stdio MCP adapter. Keeps the mcp name (it IS mcp).
    src/
      mcp/tools/     # tool registrations (proxy-path only)
      index.ts       # one entrypoint: stdio. No transport switch.
  lore-api/          # REMOTE ONLY — HTTPS REST API. No "mcp" anywhere.
    src/
      routes/        # folder-per-route-area (see below)
      features/      # DB-backed implementations (pg, octokit, GCS, tree-sitter)
      http-server.ts
      index.ts       # one entrypoint: HTTP. No transport switch.
libs/
  server-core/       # NEW. Light shared logic both apps import.
                     # repo-detect, proxy client, file-fallback memory,
                     # template loading, zod schemas, shared types.
                     # MUST NOT depend on pg/octokit/GCS/tree-sitter.
```

The `MCP_TRANSPORT` switch disappears: each app has exactly one runtime, so
`transports.ts`'s mode branch is deleted. Local is always stdio; remote is
always HTTP.

### The dependency boundary (the hard part)

The local tool modules today import feature modules that *also* contain the
DB-backed implementation (e.g. `pipeline-tools.ts` → `features/pipeline/pipeline.ts`,
which imports `pg`). Slimming the local app requires drawing a clean line:

- **`libs/server-core` (light):** everything the local adapter touches on the
  proxy path — `repo-detect`, the HTTP proxy client, `memory-file` fallback,
  context/spec-trace proxy callers, template loading, shared zod schemas and
  types. No heavy native or cloud deps.
- **`apps/lore-api/features` (heavy):** the Postgres/Octokit/GCS/tree-sitter
  implementations behind the REST routes.

The local app's `package.json` ends with a minimal dependency set; the remote
app's keeps the heavy ones. The success of this feature is measured at that
boundary, not at the folder structure.

### Route organization (resolved: folder-per-endpoint)

`apps/lore-api/src/routes/` becomes **one folder per HTTP endpoint**. Modules
that today bundle several endpoints (e.g. `webhooks.ts` → github/slack/incident;
`tasks.ts` → list/get/post) are split so each endpoint owns a folder with its
handler, its test, and any endpoint-local helpers. A top-level `routes/index.ts`
dispatcher and the shared `http`/`auth`/`helpers` modules stay at the `routes/`
root. The concrete endpoint list is derived from the current dispatcher in
Phase 2.

### Naming changes (remote sheds `mcp`) — resolved: code/user-facing only

Rename what developers and clients touch; leave infra-internal identifiers be
(renaming a Helm release = uninstall+reinstall; a terraform module rename churns
state — both pure risk for zero functional gain, and neither serves the leanness
or naming-honesty goal).

- Package: `@re-cinq/lore-mcp` (remote) → `@re-cinq/lore-api`. Local keeps
  `@re-cinq/lore-mcp`.
- Boot log: `MCP server (HTTP REST API) listening` → `Lore API listening`.
- Env `MCP_TRANSPORT`: removed (no longer needed).
- Docker image: retargeted to the `lore-api` app (`ghcr.io/re-cinq/lore-api`).
- **Infra identity** `lore-mcp` / `mcp-servers`: the split *kept* it (the code
  merge changed only image + env), landing on the `lore-platform` umbrella
  layout (#753) — chart at `lore-platform/charts/mcp-helm/`, config in
  `lore-platform.tf` (the former `lore-mcp.tf` is gone). The deferred OQ-2
  follow-up then **renamed it to `lore-api` / `lore-api`** (chart
  `charts/lore-api-helm/`, namespace `lore-api`, DNS `lore-api.lore-api…:3000`) —
  see tasks Phase 8.

## Functional Requirements

- **FR-1** Two independently buildable, independently deployable apps:
  `apps/mcp-server` (stdio MCP) and `apps/lore-api` (HTTPS REST). Each has its
  own `package.json`, `tsconfig`, build, and test command.
- **FR-2** Shared light logic lives in `libs/server-core`; both apps import it.
  `libs/server-core` declares no dependency on `pg`, `octokit`,
  `@google-cloud/storage`, `tree-sitter*`, or the OTel gRPC exporters.
- **FR-3** `apps/mcp-server/package.json` (local) lists **none** of the
  remote-only deps in FR-2. `npm ls` in the local app resolves no heavy
  transitive copy of them.
- **FR-4** The remote app exposes the identical `/api/*` surface it does today —
  same paths, auth, body limits, status codes. No behavior change for clients.
- **FR-5** `apps/lore-api/src/routes/` is organized one folder per HTTP
  endpoint; the dispatcher and `http`/`auth`/`helpers` remain at the `routes/`
  root.
- **FR-6** The remote app carries no `mcp` in its package name, image, boot log,
  or env. The `MCP_TRANSPORT` env var is removed and the transport switch
  deleted.
- **FR-7** Local stdio behavior is unchanged: the same `lore_*` tools register
  and behave identically (proxy to `LORE_API_URL`, file fallback to `~/.lore`).
  The server-core proxy client round-trips a GET read and a POST write through the
  real lore-api server (the change persists in the DB), and returns
  `not_configured` when no `LORE_API_URL` is set. ([validated by `proxy.test.ts:91`](apps/lore-api/src/integration-tests/proxy.test.ts#L91), [validated by `proxy.test.ts:104`](apps/lore-api/src/integration-tests/proxy.test.ts#L104), [validated by `proxy.test.ts:132`](apps/lore-api/src/integration-tests/proxy.test.ts#L132))
- **FR-8** Infra points at the new remote app: Dockerfile, Helm values,
  terraform, and CI workflows build/deploy `apps/lore-api`.
- **FR-9** Developer scripts updated: `install.sh`, `dev-local.sh`,
  `lore-doctor.sh`, `lore-init.sh` reference the correct package/app for each
  runtime.

- **FR-10** A package declares every dependency it imports at runtime, at
  dependency strength — a runtime import reached only through a
  `devDependency` breaks the moment an install omits dev deps. `libs/shared`
  declares `libsodium-wrappers` in `dependencies`, not `devDependencies`,
  because `platform-github.ts` imports it at runtime to encrypt the ingest
  token before uploading it as a GitHub Actions secret during repo
  onboarding. The import is indirected through a variable
  (`const spec = "libsodium-wrappers"`) to avoid demanding a declaration file
  for an untyped package, which makes it invisible to every static dependency
  checker — so the declaration is pinned by a test rather than by tooling. ([validated by `runtime-deps.test.ts:23`](libs/shared/src/project/lib/runtime-deps.test.ts#L23), [`runtime-deps.test.ts:27`](libs/shared/src/project/lib/runtime-deps.test.ts#L27), [`runtime-deps.test.ts:31`](libs/shared/src/project/lib/runtime-deps.test.ts#L31))

## Success Criteria

- **SC-1** From a clean checkout, `npm install` scoped to the local app
  (`apps/mcp-server`) installs no `pg`, `octokit`, `@google-cloud/storage`,
  `tree-sitter*`, or OTel gRPC exporter. Demonstrated via `npm ls`.
- **SC-2** Both apps `build`, `typecheck`, and `test` green independently.
- **SC-3** The remote REST contract test suite passes unchanged against
  `apps/lore-api` (same routes, auth, limits).
- **SC-4** Local stdio adapter starts, registers every `lore_*` tool, and a
  smoke `lore_assemble_context` proxies successfully — identical to pre-split.
- **SC-5** `grep -ri mcp apps/lore-api` returns nothing in package name, image,
  boot log, or env (MCP-protocol-internal references in shared SDK types
  excepted).
- **SC-6** GKE deploys `apps/lore-api`; the local install path provisions
  `apps/mcp-server`. No `MCP_TRANSPORT` anywhere.

## Non-Goals

- No change to the REST API contract, auth model, or tool semantics.
- No change to which features exist — this is structural, not functional.
- No rewrite of the proxy mechanism beyond what FR-2/FR-3 require to draw the
  dependency line.

## Resolved Decisions

- **OQ-1 → folder-per-endpoint.** One folder per HTTP endpoint; multi-endpoint
  modules are split.
- **OQ-2 → code/user-facing rename in the split; infra identity renamed as the
  follow-up.** The split renamed package/image/boot-log and removed
  `MCP_TRANSPORT`, keeping the K8s/Helm/terraform identity `lore-mcp`/`mcp-servers`.
  The full identity rename to `lore-api`/`lore-api` then landed as the Phase-8
  follow-up (branch `infra/rename-lore-api-workload`).
- **OQ-3 → new `libs/server-core`** (`@re-cinq/lore-server-core`), distinct from
  the pure-helper `@re-cinq/lore-shared`.
