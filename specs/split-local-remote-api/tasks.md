# Tasks: Split Local MCP Adapter from Remote HTTP API

**Status: COMPLETE — merged to `main` 2026-06-30.** Three packages green —
server-core (109), lore-api (408), mcp-server (143). SC-1 verified (no
pg/octokit/GCS/OTel-SDK in the local production install; tree-sitter remains
transitive via lore-shared, a tracked follow-up). Merged on top of the
`lore-platform` umbrella-chart consolidation (#753) and the deploy-script
serialization (#755); Phase 4 infra was reconciled onto the umbrella layout at
merge time (see T019/T020/T021b). The infra-internal workload + namespace rename
`lore-mcp`/`mcp-servers` → `lore-api`/`lore-api` (ADR-032 OQ-2, originally
deferred) is **done as the Phase-8 follow-up** on branch
`infra/rename-lore-api-workload` — pending only its namespace-cutover
`terraform apply`. Manual deploy + test: Phase 7.

Legend: `[P]` = parallelizable with siblings in the same phase.

## Phase 0 — Decision recorded

- [x] T001 Write `adrs/ADR-032-split-local-remote-api.md` (MADR): context (fused
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
- [x] T005b *(moved to Phase 3 — slimming)* Proxy the GCS log-reads in
  `pipeline-tools.ts` and the onboard calls in `repo-tools.ts` to the existing
  REST endpoints; this removes `@google-cloud/storage` + `octokit` from the local
  app once it is split out.

## Phase 2 — Stand up the remote app (`apps/lore-api`)

- [x] T008 Scaffold `apps/lore-api`: `package.json` (name `@re-cinq/lore-api`,
  the heavy deps), `tsconfig.json`, `vitest` config; add to root `workspaces`.
- [x] T009 Move the remote runtime into `apps/lore-api/src`: `server/http-server.ts`,
  `api/routes/**`, and the DB-backed `features/**` + `platform/**` the routes
  need (`db`, `github-client`, `otel`, `anthropic-client`, GCS, tree-sitter).
- [x] T010a Derive the canonical endpoint list from the current `routes/index.ts`
  dispatcher (every `/api/*` path it routes). This list defines the folders.
- [x] T010b Reorganize routes into folder-per-endpoint: one `routes/<endpoint>/`
  per HTTP endpoint with its handler + `*.test.ts` + endpoint-local helpers.
  Split multi-endpoint modules (`webhooks.ts` → github/slack/incident;
  `tasks.ts` → list/get/post; etc.). Keep `routes/index.ts` dispatcher and
  shared `http.ts`/`auth.ts`/`helpers.ts` at `routes/` root. Fix import depth.
- [x] T011 New entrypoint `apps/lore-api/src/index.ts`: init OTel + DB pool,
  load task types + templates, `startHttpServer()`. No MCP server, no transport
  switch.
- [x] T012 Drop `mcp` from the remote: boot log → `Lore API listening on :PORT`;
  remove `MCP_TRANSPORT` reads; package name `@re-cinq/lore-api`.
- [x] T013 Run the remote test suite (moved REST contract tests) green against
  `apps/lore-api`. (SC-3)

## Phase 3 — Slim the local app (`apps/mcp-server`)

- [x] T014 Delete the remote runtime from `apps/mcp-server`: `server/http-server.ts`,
  `api/**`, the transport-switch in `transports.ts` (now just stdio), and the
  DB-backed `features/**`/`platform/**` moved to `lore-api`.
- [x] T015 New/trimmed `apps/mcp-server/src/index.ts`: build MCP server, connect
  stdio transport, session-log dump on exit. Tools import from
  `@re-cinq/lore-server-core`.
- [x] T016 Prune `apps/mcp-server/package.json` to local deps only: MCP SDK,
  `zod`, `yaml`, `@re-cinq/lore-shared`, `@re-cinq/lore-server-core`. Remove
  `pg`, `octokit*`, `@google-cloud/storage`, `tree-sitter*`, OTel gRPC exporters.
- [x] T017 Verify SC-1: `npm ls` in `apps/mcp-server` resolves none of the heavy
  deps. `apps/mcp-server` builds + typechecks + tests green. (SC-2, SC-4)

## Phase 4 — Infrastructure

> Landed on the `lore-platform` umbrella layout (#753) at merge time. The Helm
> chart relocated to `lore-platform/charts/mcp-helm/`, and the per-service
> `lore-mcp.tf` was deleted — its config is now the single
> `helm_release.lore_platform` in `lore-platform.tf`. T019/T020 reflect the
> as-merged paths (K8s/Helm/terraform identity `lore-mcp`/`mcp-servers` kept per
> OQ-2 — only image + env changed).

- [x] T018 [P] `apps/lore-api/Dockerfile`: build + run the remote app (moved from
  `apps/mcp-server/Dockerfile`; build context/paths cover shared + server-core +
  lore-api). Local app's Dockerfile removed.
- [x] T019 [P] Helm (umbrella): `lore-platform/charts/mcp-helm/values.yaml` (chart
  dir + release/Service `lore-mcp` kept per OQ-2) — drop `MCP_TRANSPORT`, retarget
  image to `ghcr.io/re-cinq/lore-api`.
- [x] T020 [P] Terraform: drop `MCP_TRANSPORT` from the `lore-mcp` subchart env in
  `lore-platform.tf` (the former `lore-mcp.tf` is gone, replaced by the umbrella
  release).
- [x] T021 [P] CI: `build-mcp.yml` → `build-lore-api.yml` (image `re-cinq/lore-api`,
  `apps/lore-api/Dockerfile`, umbrella chart trigger paths; deploy via
  `scripts/ci/deploy-lore-platform.sh lore-mcp <tag> lore-mcp mcp-servers`).
  `test.yml` + `lore-tests.yml` build/test both apps + `server-core`.
- [x] T021b Merge reconciliation: re-applied the Phase-4 infra changes onto the
  umbrella layout when `main` adopted #753/#755 (chart-path move, `lore-mcp.tf`
  delete, deploy-script call, CI workflow-rename conflict). Helm render verified:
  the `lore-mcp` Deployment ships `ghcr.io/re-cinq/lore-api`, no `MCP_TRANSPORT`.

## Phase 5 — Scripts & docs

- [x] T022 [P] `scripts/install.sh` + `lore-init.sh`: provision the local
  `apps/mcp-server` adapter (new lean install); fix package references.
- [x] T023 [P] `scripts/dev-local.sh`: run `apps/lore-api` (http) and
  `apps/mcp-server` (stdio) separately; remove `MCP_TRANSPORT`.
- [x] T024 [P] `scripts/lore-doctor.sh`: check the correct package/app per
  runtime.
- [x] T025 [P] Docs: `docs/INSTALL.md`, `docs/mcp-tools-reference.md`,
  `docs/mcp-transport-options.md` (now obsolete — fold/retire), `apps/*/README.md`,
  and CLAUDE.md architecture section reflect the two-app split.

## Phase 6 — Verify

- [x] T026 Full green: both apps build + typecheck + test (SC-2); remote REST
  contract suite passes (SC-3); local smoke `lore_assemble_context` proxies
  (SC-4); `grep -ri mcp apps/lore-api` clean (SC-5); no `MCP_TRANSPORT` anywhere
  (SC-6); `npm ls` confirms lean local (SC-1).

## Phase 7 — Manual deployment & testing (post-merge)

> The merge to `main` triggers `build-lore-api.yml`, which builds the image and
> rolls it onto the `lore-mcp` Deployment automatically. The manual
> `terraform apply` reconciles only the terraform-owned config + secrets. Deploy
> runbook (creds table + where to get each) lives with the deploy ticket.

- [ ] T027 Confirm CI built + pushed `ghcr.io/re-cinq/lore-api:<sha>` on the merge
  to `main` and `deploy-lore-platform.sh` rolled the workload
  (`kubectl rollout status deployment/lore-mcp -n mcp-servers`).
- [ ] T028 Manual `terraform apply`: `cd infra/terraform`; creds in `secrets.tfvars`
  (copied from `secrets.tfvars.example`, gitignored via `*.tfvars`); non-secret
  deploy vars (`project_id`, `cluster_name`, URLs, `github_org`) in the same file
  or `-var`. `terraform init && terraform plan -var-file=secrets.tfvars`.
- [ ] T029 DB-safety gate (review the plan before apply): it MUST show **zero**
  `destroy` on `kubernetes_namespace.lore_db`/`lore_dgraph`,
  `kubectl_manifest.lore_db_cluster` (CNPG), the Dgraph StatefulSet, or any PVC.
  Reuse the existing `lore-db-password` (don't rotate). Abort if any stateful
  destroy appears; otherwise `terraform apply`.
- [ ] T030 In-cluster smoke: the `lore-mcp` pod runs `ghcr.io/re-cinq/lore-api`,
  `/healthz` returns 200, the web-UI reaches the API at
  `http://lore-mcp.mcp-servers.svc.cluster.local:3000`, `scripts/smoke-test.sh`
  green against `LORE_API_URL`.
- [ ] T031 Local adapter smoke from a clean machine: `install.sh` provisions the
  lean `apps/mcp-server`, and `lore_assemble_context` proxies to the deployed API.
  (SC-4 end-to-end)

## Phase 8 — Full `lore-api` workload + namespace rename (OQ-2 follow-up)

> Done on branch `infra/rename-lore-api-workload` (rebased onto `main`). Renames
> the K8s/Helm/terraform identity `lore-mcp`/`mcp-servers` → `lore-api`/`lore-api`:
> chart dir → `lore-api-helm`, Chart name (drives Deployment/Service names), the
> 8 ESO ExternalSecrets, the namespace, the in-cluster DNS, and the CI deploy
> call. **Cosmetic — the split deploys without it.** Carries a namespace
> destroy+recreate (stateless; the DBs are in disjoint namespaces, never
> touched). Helm render verified green — 0 stale `lore-mcp`/`mcp-servers` in the
> rendered output.

- [x] T032 Apply the rename across chart/terraform/ESO/CI/DNS; rebase onto `main`
  (keeps main's image-repo pin from `8730c23`). Verified via `helm template`.
- [ ] T033 Deploy the rename: `terraform plan` must show only the
  `mcp-servers`→`lore-api` namespace + ESO secret recreate (no DB/PVC destroy);
  apply; verify the `lore-api` Deployment/Service in the `lore-api` namespace and
  the UI's updated `LORE_API_URL`.
