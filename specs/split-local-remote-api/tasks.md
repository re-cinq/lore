# Tasks: Split Local MCP Adapter from Remote HTTP API

Legend: `[P]` = parallelizable with siblings in the same phase.

## Phase 0 — Decision recorded

- [x] T001 Write `adrs/ADR-030-split-local-remote-api.md` (MADR): context (fused
  app forces remote deps onto local installs; `mcp` name on a non-MCP REST
  surface), decision (two apps + `libs/server-core`, drop `MCP_TRANSPORT`),
  consequences, alternatives (keep fused + tree-shake; split-within-app).
- [x] T002 Commit spec + ADR. Resolve OQ-1/OQ-2/OQ-3 in the ADR before coding.

## Phase 1 — Extract the light shared core (`libs/server-core`)

> Re-scoped after recon — see `research.md`. The codebase already separates
> logic from heavy value-deps via pool injection + type-only `pg`, so this is a
> **carve + two targeted splits**, not a fused-module teardown.

- [x] T004 Recon: map the real local↔remote dependency line (value/dynamic
  imports of `pg`/`octokit`/`GCS`/`tree-sitter`/OTel-SDK). → `research.md`.
- [x] T003 Scaffold `libs/server-core` (package `@re-cinq/lore-server-core`):
  `package.json` (light deps only — `zod`, `yaml`, `@opentelemetry/api`, `glob`,
  `@re-cinq/lore-shared`), `tsconfig.json`, `vitest.config.ts`; picked up by the
  root `libs/*` workspace glob.
- [x] T005a Split `platform/otel.ts`: light helpers (`traceTool`,
  `traceRetrieval`, `traceHttp`, `traceTaskCreated`, …, on `@opentelemetry/api`)
  → `server-core/platform/otel.ts`; heavy `initOtel`/`shutdownOtel` (NodeSDK +
  exporters) → `apps/mcp-server/platform/otel-init.ts` (moves to `lore-api` boot
  in Phase 3). `index.ts` imports `initOtel` from `otel-init`.
- [x] T006 Moved the 18 pool-injected light modules (+ 11 co-located tests) into
  `server-core` preserving structure; also relocated the proxy client
  (`proxy.ts`, was in `deps.ts`) and the YAML templates (`libs/server-core/templates`
  + `loadDefaultTemplates()`). Collision-safe codemod repointed 100 import
  specifiers across 36 mcp-server files to `@re-cinq/lore-server-core/*`. `deps.ts`
  re-exports the proxy client so the tool modules are untouched.
- [x] T007 Verified: `server-core` direct deps are all light (no
  `pg`/`octokit`/`@google-cloud/storage`/`@opentelemetry/sdk-node`); both
  packages build + typecheck; `server-core` 109 tests + `mcp-server` 551 tests
  green. **Caveat:** `tree-sitter` still arrives transitively via
  `@re-cinq/lore-shared` — pre-existing, tracked for a later lore-shared split.
- [ ] T005b *(moved to Phase 3 — slimming)* Proxy the GCS log-reads in
  `pipeline-tools.ts` and the onboard calls in `repo-tools.ts` to the existing
  REST endpoints; this removes `@google-cloud/storage` + `octokit` from the local
  app once it is split out.

## Phase 2 — Stand up the remote app (`apps/lore-api`)

- [ ] T008 Scaffold `apps/lore-api`: `package.json` (name `@re-cinq/lore-api`,
  the heavy deps), `tsconfig.json`, `vitest` config; add to root `workspaces`.
- [ ] T009 Move the remote runtime into `apps/lore-api/src`: `server/http-server.ts`,
  `api/routes/**`, and the DB-backed `features/**` + `platform/**` the routes
  need (`db`, `github-client`, `otel`, `anthropic-client`, GCS, tree-sitter).
- [ ] T010a Derive the canonical endpoint list from the current `routes/index.ts`
  dispatcher (every `/api/*` path it routes). This list defines the folders.
- [ ] T010b Reorganize routes into folder-per-endpoint: one `routes/<endpoint>/`
  per HTTP endpoint with its handler + `*.test.ts` + endpoint-local helpers.
  Split multi-endpoint modules (`webhooks.ts` → github/slack/incident;
  `tasks.ts` → list/get/post; etc.). Keep `routes/index.ts` dispatcher and
  shared `http.ts`/`auth.ts`/`helpers.ts` at `routes/` root. Fix import depth.
- [ ] T011 New entrypoint `apps/lore-api/src/index.ts`: init OTel + DB pool,
  load task types + templates, `startHttpServer()`. No MCP server, no transport
  switch.
- [ ] T012 Drop `mcp` from the remote: boot log → `Lore API listening on :PORT`;
  remove `MCP_TRANSPORT` reads; package name `@re-cinq/lore-api`.
- [ ] T013 Run the remote test suite (moved REST contract tests) green against
  `apps/lore-api`. (SC-3)

## Phase 3 — Slim the local app (`apps/mcp-server`)

- [ ] T014 Delete the remote runtime from `apps/mcp-server`: `server/http-server.ts`,
  `api/**`, the transport-switch in `transports.ts` (now just stdio), and the
  DB-backed `features/**`/`platform/**` moved to `lore-api`.
- [ ] T015 New/trimmed `apps/mcp-server/src/index.ts`: build MCP server, connect
  stdio transport, session-log dump on exit. Tools import from
  `@re-cinq/lore-server-core`.
- [ ] T016 Prune `apps/mcp-server/package.json` to local deps only: MCP SDK,
  `zod`, `yaml`, `@re-cinq/lore-shared`, `@re-cinq/lore-server-core`. Remove
  `pg`, `octokit*`, `@google-cloud/storage`, `tree-sitter*`, OTel gRPC exporters.
- [ ] T017 Verify SC-1: `npm ls` in `apps/mcp-server` resolves none of the heavy
  deps. `apps/mcp-server` builds + typechecks + tests green. (SC-2, SC-4)

## Phase 4 — Infrastructure

- [ ] T018 [P] `apps/lore-api/Dockerfile`: build + run the remote app (move from
  `apps/mcp-server/Dockerfile`, retarget build context/paths). Remove the local
  app's Dockerfile if it was only ever the remote image.
- [ ] T019 [P] Helm: in `infra/terraform/modules/gke-mcp/mcp-helm` (dir name
  kept per OQ-2) drop `MCP_TRANSPORT` from `values.yaml` and retarget the image
  to `lore-api`.
- [ ] T020 [P] Terraform: update `infra/terraform/lore-mcp.tf` (file/module name
  kept per OQ-2) — image + env only.
- [ ] T021 [P] CI: `.github/workflows/test.yml` + `lore-tests.yml` build/test
  both apps under their new names.

## Phase 5 — Scripts & docs

- [ ] T022 [P] `scripts/install.sh` + `lore-init.sh`: provision the local
  `apps/mcp-server` adapter (new lean install); fix package references.
- [ ] T023 [P] `scripts/dev-local.sh`: run `apps/lore-api` (http) and
  `apps/mcp-server` (stdio) separately; remove `MCP_TRANSPORT`.
- [ ] T024 [P] `scripts/lore-doctor.sh`: check the correct package/app per
  runtime.
- [ ] T025 [P] Docs: `docs/INSTALL.md`, `docs/mcp-tools-reference.md`,
  `docs/mcp-transport-options.md` (now obsolete — fold/retire), `apps/*/README.md`,
  and CLAUDE.md architecture section reflect the two-app split.

## Phase 6 — Verify

- [ ] T026 Full green: both apps build + typecheck + test (SC-2); remote REST
  contract suite passes (SC-3); local smoke `lore_assemble_context` proxies
  (SC-4); `grep -ri mcp apps/lore-api` clean (SC-5); no `MCP_TRANSPORT` anywhere
  (SC-6); `npm ls` confirms lean local (SC-1).
