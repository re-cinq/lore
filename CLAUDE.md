# Lore

Shared context infrastructure for Claude Code. One install command
gives developers full org awareness — conventions, ADRs, team patterns,
PR history, and task state.

## Architecture

**Two deployables sharing a light core** (ADR-032):
- **`apps/mcp-server`** (`src/index.ts`) — the local stdio MCP adapter. Speaks
  the MCP protocol to Claude Code and proxies every data operation to the remote
  Lore API (`LORE_API_URL`). Lean install: no pg/octokit/GCS/OTel-SDK. Three core
  tools: `lore_assemble_context`, `lore_search_context`, `lore_search_memory`,
  plus pipeline delegation, the local task runner, and 30+ tools total. Also runs
  as the shared **`lore-mcp` HTTP gateway** for agent pods: with `LORE_MCP_HTTP=1`
  it mounts the SDK's `StreamableHTTPServerTransport` (`src/server/http-transport.ts`)
  instead of stdio, and `LORE_MCP_SERVER_MODE=agent` (`build-mcp-server.ts`) omits
  the laptop-only + `lore_create_pipeline_task` tools. Deployed by `charts/lore-mcp-helm`
  (image `ghcr.io/re-cinq/lore-mcp`) in the `lore-api` namespace; agent recipes reach
  it via a `resources.mcp_servers` entry (ADR-030/031/032). The gateway also serves the
  **agent-skills registry** (`src/server/skills-registry.ts`) at `/skills/<name>.tar.gz`
  + `/skills/hooks/<vendor>.tar.gz` (a per-vendor hook bundle laid out relative to `$HOME`;
  `hooks/claude/.claude/settings.json` wires the `lore-context` skill's `guard-tests.sh` as
  the Bash `PreToolUse` guard and is also served as the flat `/skills/settings.json`;
  `hooks/gemini/.gemini/settings.json` wires the same script as a `BeforeTool` hook on
  `run_shell_command`, wrapped to report a refusal as the `{"decision":"block"}` document
  gemini-cli reads instead of an exit code)
  (unauthenticated; bundle baked from `apps/mcp-server/agent-skills/`); the
  ai-agent-subsystem init fetches these into a run's `$HOME` via the recipe's
  `resources.skills` + `skills_source` (ADR-030 skills seam).
- **`apps/lore-api`** (`src/index.ts` + `src/server/http-server.ts`) — the remote
  HTTPS REST backend (`/api/*`) on GKE. Routes are organized one folder per
  endpoint under `src/api/routes/`; the DB/GitHub/GCS/tree-sitter work lives here.
  No MCP — it is a plain REST API.
- **`libs/server-core`** (`@re-cinq/lore-server-core`) — the light business logic
  both apps import (memory, context assembly, repo-detect, pipeline CRUD, the API
  proxy client, the `@opentelemetry/api` trace/metric helpers, YAML templates).

**Vector store**: PostgreSQL + pgvector via CloudNativePG on GKE.
Schema-per-team isolation. HNSW indexes for vector search, GIN for
BM25 keyword search. Hybrid search via Reciprocal Rank Fusion.
Embeddings from Vertex AI text-embedding-005 (768 dimensions).

**Cluster agents**: Lore Agent service on GKE processes pipeline tasks
via direct Anthropic API calls (simple tasks) or headless Claude Code
(complex tasks). Developers delegate through the Lore MCP server,
never directly.

**Observability**: OpenTelemetry traces + metrics → Cloud Monitoring.
Gap signal goes to Graphiti episodes in Phase 3.

**Task tracking**: Pipeline tasks via Lore MCP + GitHub Issues.

## Code Conventions

**TypeScript** for the MCP server. ESM modules, strict mode, ES2023
target. Zod for input validation on all MCP tools. Return errors as
text in MCP responses, never throw.

**Python** for glue scripts (lore-gen-constitution).
Keep them short (<100 lines). Handle missing tools gracefully with
clear error messages.

**Bash** for install.sh, lore-doctor, infra scripts. Must be
idempotent — safe to re-run. Prefix output with `[lore]`. Exit 0 on
success, 1 on failure.

**Helm charts** for K8s deployments. All eight service workloads ship as
ONE umbrella chart, `lore-platform` (vendoring event-router/cluster-agent/
lore-api/lore-mcp/stations/ui/lore-db/ai-agents subcharts under `charts/`); one
`helm_release.lore_platform` deploys them. Every service has a `build-*.yml`
workflow that builds its image and deploys it into the umbrella release via
`scripts/ci/deploy-lore-platform.sh`; chart values read `tag: latest` only as a
never-used default, because that script pins the short SHA with `--set-string`.
Values files should have sane defaults. No hardcoded secrets — use
K8s Secrets.

**No long-lived credentials anywhere.** Workload Identity on GKE,
gcloud auth for local dev.

**Spec status upkeep.** When a branch implements or completes a feature
described in `specs/<name>/spec.md`, update that spec's `| Status |`
header row in the same branch (Draft → Implemented/Shipped; Rejected for
abandoned designs). The web-ui spec lists render this header as the
status pill — a stale header misreports the org's backlog.

## Key Components

- `apps/mcp-server/` — the MCP server (TypeScript)
- `apps/lore-api/src/transport/routes.ts` — barrel for the HTTP API layer; the native hapi routes are registered by `apps/lore-api/src/app/build-server.ts`, one folder per endpoint under `apps/lore-api/src/transport/routes/` — e.g. `routes/tasks/task-timeline.ts` (`/api/tasks/:uuid/timeline`), `routes/tasks/task-by-pr.ts` (the PR↔task resolver)
- `apps/lore-api/src/work/two-key/approval-pr.ts` — `verifyApproval()` runs the CODEOWNERS-approval-PR ceremony (open PR labeled `dark-factory-approval` by a CODEOWNER of the repo's `CLAUDE.md`); `routes/two-key.ts` `checkApproval` applies it to agent-definition writes that set `image` (`specs/two-key-approval`)
- `libs/shared/src/outbound/project/leases/lease-backends.ts` — `DbLeaseBackend` (Postgres CTE-based atomic acquire with takeover detection) + `FileLeaseBackend` (worktree mode under `~/.lore/leases/`) sharing a `LeaseBackend` interface (FR1.6)
- `libs/assembly-lines/src/transition.ts` — `nextTransition()`: the pure replay that derived the old walk's next step from the persisted `pipeline.station_runs` rows + the definition graph. Its driver was Lore's own Floor (`apps/floor`), deleted on 2026-10-02; the module, the old line files beside it and the node stations under `apps/stations/src/work/` that only that walk dispatched are left to delete in a follow-up (#2342)
- `libs/assembly-lines/src/loader.ts` — Zod schema for assembly line YAML, cycle detection (DFS coloring; back-edges require `iteration_max`), reachability check; nodes carry optional `station_ref` (custom station image) + `timeout_minutes`, and detect nodes require `job_ref`
- `libs/assembly-lines/src/assembly-lines/*.yaml` — the line files Lore's own Floor walked. Nothing walks them since `apps/floor` was deleted (2026-10-02); they are history until the follow-up removes them. The lines that run are `libs/assembly-lines/src/floor-pipelines/*.yaml`, on the external floor
- **External floor** (ADR-049, `specs/external-floor/`) — the rewritten Floor ([re-cinq/floor](https://github.com/re-cinq/floor)) runs in the same cluster and is the only engine: `apps/floor`, which it replaced one family of lines at a time, was deleted on 2026-10-02 (`specs/external-floor` FR16); Lore reaches it only through `@re-cinq/floor-client` (`libs/shared/src/outbound/floor/floor-client.ts`, `FLOOR_API_URL` + `FLOOR_SERVICE_TOKEN`, terraform `enable_external_floor`). **The code-review family runs there**: `libs/assembly-lines/src/floor-pipelines/{code-review,code-review-recheck,code-review-reply,lore-run-settled}.yaml` are floor pipeline files (line + stations + agent definitions, prompt inline) that lore-api puts to the floor at every boot — a version is its content, so only a file that changed becomes a new version (`apps/lore-api/src/work/floor/seed-floor-pipelines.ts`). The stations drain turns PR-lifecycle events into `lines.start` / `runs.cancel` (`apps/stations/src/events/floor-review-handlers.ts` → `libs/shared/src/work/review/floor-review-start.ts`: opened→review + started-comment, push→re-check, request-changes review from a trusted reviewer→reply, closed→cancel; gated on `auto_review`, bots skipped; the linked issue's text rides along as the `issue` file). Lore's floor stations live one folder each under `apps/stations/src/code-review/` (`post-review`, `read-review`, `post-reply`, `run-settled`), written with `@re-cinq/floor-station`. lore-api mints the floor's git credentials (`POST /api/floor/git-credential`) and shows floor runs on the existing run page (`apps/lore-api/src/work/floor/`: `floorBackedRuns` answers from Postgres first, the floor otherwise; `FloorRunFeeds` relays the floor's per-run socket onto the `run` channel)
- **Spec upkeep on the external floor** (`specs/external-floor` FR14, 2026-10-01) — `libs/assembly-lines/src/floor-pipelines/spec-upkeep.yaml`: `detect-drift → detect-unlinked → update-specs → open-pr → await-ci ⇄ fix-ci → request-review`, one run per onboarded repo started by the stations tick `cron.spec_upkeep.tick` (Mondays 10:00 UTC, `apps/stations/src/work/spec-upkeep-tick/`). The detectors (`libs/shared/src/work/spec-upkeep/findings.ts`) read the traceability graph and call no model; the agent fixes drift and adds test links as two commits. The old `spec_drift` and `spec_coverage_backfill` ticks are gone (2026-10-02, FR16.6), with `gap_detection` and `spec_coverage_validate`: nothing starts a detection line on Lore's own Floor
- **Implementation loop on the external floor** (`specs/external-floor` FR12/FR13, 2026-10-01) — `libs/assembly-lines/src/floor-pipelines/implementation-loop.yaml` (`dod → open-pr → tdd-round ⇄ await-ci → ready-for-review → mark-ready → await-pr ⇄ fix-ci`); the driver is shared code in `libs/shared/src/work/backlog/` (`implementation-loop-tick.ts` picks, `floor-loop.ts` starts, `loop-run-closed.ts` + `loop-infra-deferral.ts` settle and defer). With a floor configured the stations service runs the tick (`apps/stations/src/work/loop-tick/`) and settles tickets in the `run-settled` station (`apps/stations/src/code-review/run-settled/loop-closed.ts`); The old Floor's own wiring of it went with `apps/floor`. A loop run is keyed on `backlog:tickets` (one ticket per repo), not on its task. **A plan's spec-tasks run on the same line** (FR15): the executor (`libs/shared/src/work/spec-task/`, stations tick `apps/stations/src/work/spec-task-tick/` on `cron.spec_task_executor.tick`) starts one run per ready task keyed on `backlog:spec-task-<task id>`, so they run beside the backlog; a parked task gets a comment on its task issue and no `lore:blocked` label
- `libs/assembly-lines/src/node-outcome.ts` — `stationNodeOutcome()` + `parseNodeResult()`/`parseReviewVerdict()` for the station contract's `LORE_NODE_RESULT` line; outcome precedence LORE_NODE_RESULT → REVIEW_RESULT → success, CR `Failed` → `<kind>-failed`. Consumed by the `lore-station` pods; the Floor-side node-event handler and reaper went with `apps/floor`. Node-execution types (`StageOutcome`/`NodeResult`/`NodeContext`) live in `node-types.ts`. (The old `station-node-handler.ts` poll loop retired with the in-process walk.)
- `apps/lore-station/` — the station pod entrypoint image (`ghcr.io/re-cinq/lore-station`, `lore-station <type> '<station_input json>'`): runs one non-agent node per pod (validate/gate/github_action/detect/ingest) via the subsystem's `exec` vendor; service-runtime node types (retrospective, merge_step, issues) run in the pooled `lore-stations` service instead, published over the bus. Reads/writes over HTTP through `createStationProject(repo)` (no Postgres/App creds in the pod, D7); the detector cores live in `@re-cinq/lore-shared/detect` (facade-driven, shared by Floor + station). Contract in `specs/6-dark-factory/contracts/station-contract.md`. **Cutover complete** (ADR-031 amendment): every non-agent Floor-assembly-line node dispatches a station — the `LORE_STATION_NODES` flag + in-process node handlers are gone. The last in-process execution path (the gap-fill/runbook JSON-supervisor, `processTaskViaSupervisor`) was also removed: gap-fill now runs on the Floor AssemblyLine (per-node Agent CRs, same as implementation) and runbook (no assembly-line YAML) runs as a single Agent CR — both via `handleClaudeCodeTask`, no Floor-side clone or App token. Builtin `def-<type>` recipes are `lore.agent_definitions` rows (migrations 0027/0028/0054) that each cluster-agent's catalog sync renders into CRs; custom stations register via an `execution_mode: 'station'` agent-definitions row.
- `apps/stations/src/work/merge-check/spec-status-flip.ts` — the merge-check also runs the **spec-status-upkeep FR1** hook (`specs/spec-status-upkeep/`): when a merged `spec-task` leaves no unmerged siblings in its `task_group_id` (via `taskQueue().countUnmergedInGroup`), the pure `decideSpecStatusFlip()` gate reads the spec path the task carries in `context_bundle.spec_path` (stamped by the `issues` station from the planning line's `spec_path` arg, which the Floor derives from `spec-plan.json`) and `openSpecStatusFlipPr` (`@re-cinq/lore-shared`) opens a deterministic one-line `lore-managed`+`spec-status-upkeep` PR flipping the spec's `| Status |` row to `Implemented` (mirrors the spec-coverage-backfill PR plumbing; `rewriteSpecStatusRow` is the idempotent pure rewriter). No LLM. Human-review PRs (no auto-merge wiring). FR2 (weekly `status-staleness` detect line) is a pending follow-up
- **Plans** (ADR-047, `specs/7-feature-planning/`) — a feature is planned as a plan people and the planning agent write together, hosted by lore-api through the [planning-station](https://github.com/re-cinq/planning-station) packages (git deps on its `*-dist-v*` tags; the repo is public). `apps/lore-api/src/app/register-planning.ts` mounts `@re-cinq/planning-sync` (`/api/plans/*` + the `/api/plans/collab` WebSocket) with `pgPlanStore` (`outbound/plans/plan-store-pg.ts`, `lore.plans`/`plan_state`/`plan_versions`) and DB-backed collab tokens (`work/plans/collab-tokens.ts`); its `onApproved` hook resumes the planning line. Lore's own routes (`transport/routes/plans/plans.ts`): list, collab-token, `drafting`, `refine`. The `feature-planning` assembly line keys on `args.plan_id` (`planSubject`), and it runs on the external floor, where its agent edits the plan through `lore_plan_edit`. web-ui: `app/repos/[owner]/[repo]/plans/` mounts `@re-cinq/planning-editor` on a `plan` channel of the tab's one live socket (`LORE_WS_URL`, ADR-048), built with `transportFor` + Hocuspocus's `WebSocketPolyfill` seam (`src/lib/live-socket/channel-websocket.ts`). lore-api runs ONE replica while plans are live in it. `lore.features` is gone (migration 0088)
- **No escalation line** (deleted 2026-10-01, #2330): the two-node `file-issue → notify` line, its `escalation-step` station and the `escalation_step` node type are gone, having never run in production. The implementation loop comments on its own tickets (`libs/shared/src/work/backlog/loop-run-closed.ts`)
- `libs/shared/src/domain/models/` — **the single source of truth for every persisted shape** (32 tables, 308 columns). One file per entity: a Zod schema, the type inferred from it, and a `ColumnMap` binding each camelCase field to the snake_case column that stores it. Adapters build their SELECT lists with `selectList()` and map rows with `fromRow()`; API contracts derive their stored fields with `wireSchema()`, so one declaration reaches from the column to the generated web-ui type. `models.test.ts` discovers the folder rather than taking a registry, and FAILS on a table model whose schema will not resolve
- `libs/shared/src/lib/path-match.ts` — `allPathsMatch()` minimatch wrapper; returns true only when **every** changed path matches at least one allowlist glob
- `libs/shared/src/domain/pr-body.ts` — `prFooter()` composes the standard `Lore-Task: <uuid>` (+ optional `Refs #N`) PR-body footer used by every Lore-authored PR
- `libs/shared/src/domain/commit-trailers.ts` — `formatTrailers()` / `parseTrailers()` / `formatValidatesTrailer()` / `parseValidatesTrailers()` exported via `@re-cinq/lore-shared`. (There is no `lastStageOnBranch()`: the branch-trailer resume it belonged to was retired with the in-process walk, and "where did this run get to" is answered by the `pipeline.station_runs` replay in `libs/assembly-lines/src/transition.ts`.) Trailers are emitted unconditionally on every Lore-authored commit regardless of dark-mode setting (audit substrate for both modes)
- `libs/shared/src/outbound/project/tasks/task-queue-{port,pg,memory}.ts` — `TaskQueueRepository`: the org-wide (repo-agnostic) `pipeline.tasks` claim/sweep mechanics single-sourced out of Floor — `claimNextPending` (worker poll, immediate-first + 30s grace), `findRecoverable`/`findStaleRunning` (crash-recovery + safety-net sweeps), `findReadySpecTasks`/`countRunningSpecTasksByGroup`/`claimSpecTask` (spec-task DAG dispatch). Pg adapter + InMemory double (the behavioral spec) + colocated tests. Repo-scoped task *record* ops stay on `project.tasks`
- `libs/shared/src/outbound/project/events/event-reporter-{port,pg,memory}.ts` — `EventReporter`: the `pipeline.events` PRODUCE side, `insert` only, delegating to the shared `events.ts insertEvent` (idempotent on `dedupe_key`, fans out one `pipeline.event_deliveries` row per subscriber in the same statement). The CONSUME side is `event-deliveries-{port,pg,memory,http}.ts` (`claim` with `FOR UPDATE SKIP LOCKED`, `markDone`/`markFailed`/`markDead`, `reapStuck`, `pruneHandled`), always on the subscriber's own delivery row. `pipeline.events` carries NO status: the legacy `status`/`attempts`/`claimed_at`/`next_attempt_at`/`handled_at`/`error` columns were dropped by migration 0072 after every event ever captured sat at `pending` forever and read as a 104,000-row backlog on 2026-09-09. The consumers are the stations drain (`apps/stations/src/events/`) and the event-router; the Floor's own loop and registry went with `apps/floor`
- `libs/shared/src/outbound/project/agent-run-events/agent-run-events-{port,pg,memory}.ts` — `AgentRunEventsRepository`: the `pipeline.agent_run_events` per-tool-call agent telemetry behind the live run visualization (`specs/assembly-line-run-viz`, ADR-037). Three methods — `insertBatch` (the ingest write, which resolves `agent_cr_name` → `assembly_line_id`/`node_id`/`iteration` against `pipeline.station_runs` at write time via a `LEFT JOIN LATERAL`, newest node wins, and keeps an uncorrelated row rather than dropping it), `listSince` (the SSE catch-up read, scoped to one run and a cursor) and `pruneOld` (the retention reap). `AgentRunEventRow.id` is a string-encoded bigint — it outgrows `Number.MAX_SAFE_INTEGER` and doubles as the SSE `Last-Event-ID` cursor, so it is never narrowed to a JS number. Table + the correlation index come from migration `0031_agent_run_events.sql` (no FKs, deliberately: skip-not-fail ingest must never drop a batch).
- `libs/shared/src/outbound/project/leases/lease-backends.ts` — `LeaseBackend` gained `reapExpired(cutoff)` (Db DELETE…RETURNING with OTEL span, File scan, `InMemoryLeaseReaper` double) so the lease-reaper goes through `project.leases` instead of a Floor-local repo
- `apps/web-ui/src/app/tasks/[id]/TimelinePanel.tsx` (+ `TimelineView.tsx`) — client container + pure presentational view for the vertical stage-commit timeline (node-type icons, outcome badges, lease indicator). `TimelinePanel` fetches `/api/tasks/:id/timeline` on mount and re-fetches on the page refresh coordinator's ticks while a non-terminal stage is in flight
- `apps/lore-api/src/outbound/github-client.ts` — consolidated GitHub auth (App + token fallback)
- `apps/mcp-server/src/transport/tools/local-runner-tools.local.ts` — local task runner (worktrees, background Claude Code). Guards against pushing to the wrong repo via `validateRepoMatch(taskRepo, cwdRepo)` at spawn time; skips PR creation if `git diff --cached --name-only` is empty after stage. Task state lives in `~/.lore/local-tasks.json` only — never inside the worktree.
- `scripts/` — install.sh, lore-doctor, lore-init, glue scripts
- `scripts/infra/` — setup-db.sh, setup-schedulers.sh, generate-embeddings.sh
- `infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations/` — ordered, idempotent `NNNN_*.sql` applied to `lore-db` on every deploy by a `pre-install,pre-upgrade` Helm hook Job (`lore-platform/charts/ui-helm/templates/migrate-{job,configmap}.yaml`), tracked in `lore.schema_migrations`, connecting as `lore` (the DB owner — no superuser needed) via the chart's `dbPasswordSecret`. Runs on both deploy paths (CI `helm upgrade` of the umbrella and terraform `helm_release.lore_platform`). The hook now fires on every umbrella upgrade regardless of which service changed; it is idempotent (skip-if-applied) so re-running on a floor/mcp deploy is a no-op. Baseline schema still comes from `setup-*-schema.sh`; incremental changes go here.
- `scripts/agent-prompts/` — Lore Agent prompt templates for scheduled jobs (gap detection, spec drift, autoresearch, etc.); ingested as context, not loaded as runtime code
- `.claude/skills/` — platform skills (lore-help, lore-feature, lore-pr, lore-init, lore-agents, lore-suggest-links, lore-test-commands), installed to `~/.claude/skills` by `install.sh`. **Every skill documents itself**: each `SKILL.md` ends with a `## Help` block fenced by `<!-- lore-help:begin -->` / `<!-- lore-help:end -->` (required `**Summary.**` + `**Usage:**`), which `/lore-help` extracts verbatim to build its index, per-skill detail, and task router — there is no second copy to keep in sync. `scripts/check-skill-help.sh` (the `skill-help` PR check) fails a skill that ships without one. `install.sh` refreshes a changed skill rather than skipping it, and `lore-doctor` fails when an installed skill differs from the checkout — a stale copy would make `/lore-help` describe behaviour that is not installed. See `specs/lore-help/spec.md`
- `infra/terraform/modules/gke-mcp/lore-platform/` — the single umbrella Helm chart for the service workloads (lore-api/ui/lore-db/ai-agents and the other subcharts under `charts/`); each subchart stamps its own namespace so one release spans them. `infra/terraform/modules/gke-mcp/` also holds the standalone bootstrap root (cluster + node pools)
- `specs/` — speckit artifacts (spec, plan, tasks, research, contracts)
- `specs/assembly-line-run-viz/spec.md` — live assembly-line run observability (Shipped): projects every claude stream-json line POSTed to `POST /api/agent-events` into `pipeline.agent_run_events` (write-time truncation + `file_paths` extraction, correlated to `station_runs` via `source.agent` == `agent_cr_name`, 14-day prune), and since 2026-09-23 (FR7, ADR-048) streams it as the `run` channel of the browser's ONE live WebSocket at `/api/ws` on lore-api (was one SSE connection per run at `GET /api/assembly-runs/{id}/stream`, 2026-09-09) — `agent_event` (cursored by row id, resumed via the open's `after`), `node_status`, `run_status`, `task_event`, `ci_check` (snapshots, re-sent on every open) — fanned out by Postgres `NOTIFY` triggers (migration 0070) into ONE feed per run (`apps/lore-api/src/work/assembly-line-station/run-feed.ts`) that re-reads once and forwards to every registered viewer; the channel opens with a run-bound token minted by `POST /api/assembly-runs/{id}/stream-token` (`lore.live_tokens`, migration 0091). The page (`RunLiveShell` → `RunVisualizationPanel`) renders the DAG with a persistent inspector beside it (auto-selects running → failed → last finished; model badge per agent node from the resolved catalog), the transcript as a terminal session with the task's transitions folded in, a Definition of Done card (implementation-loop FR16) and per-file PR diffs (FR8); the 10 s `router.refresh()`, the Timeline card, the replay scrubber and the Event Timeline card are retired. Adding an unlinked statement REQUIRES flipping its `| Status |` row to `In Progress`, or `eslint .` goes red repo-wide
- `adrs/` — architecture decision records (MADR format)
- `adrs/ADR-048-one-websocket-for-live-channels.md` — ONE WebSocket per browser tab at lore-api's `/api/ws` (`apps/lore-api/src/work/assembly-line-station/`: `live-socket.ts` mounts the upgrade beside the plans library's, `protocol.ts` is the JSON channel envelope published in OpenAPI as `LiveClientMessage`/`LiveServerMessage` + root `x-websocket`, `run-channel.ts` + `run-feed.ts` serve a run's viewers from one feed per run, `plan-channel.ts` tunnels Hocuspocus bytes to the collab server `registerPlanning` returns, `live-tokens.ts` mints/verifies the run-bound tokens). web-ui side: `apps/web-ui/src/lib/live-socket/` (`connection-machine.ts` pure reconnect/resubscribe reducer, `client.ts` IO shell, `LiveSocketProvider.tsx` mounted in the root layout so navigation keeps the socket, `channel-websocket.ts` the Hocuspocus polyfill) + `useRunChannel` on the run and task pages. Supersedes ADR-037's transport choice; ADR-037's amendments on the contract and the fan-out still hold (`run-notify-hub.ts` holds one `LISTEN lore_run_stream` client outside the pool, `run-stream-session.ts` is the snapshot/replay/re-read reads). Durability lives in the table, not the bus. The raw stream is NOT discarded — since #1148 it lives in `pipeline.agent_run_turns` (`specs/turn-level-transcript-store`, readable at `GET /api/agent-turns/{assemblyRunId}`); the earlier fire-and-forget GCS archive is retired
- `adrs/ADR-045-npm-package-publishing.md` — the npm publishing convention for `@re-cinq` product packages (manifest shape, `v*` tag releases, tokenless trusted publishing over OIDC, the tag-matches-version guard, the first-publish token caveat, PA-17 hardening); reference implementation is `ai-agent-subsystem/packages/agent-contracts`
- `teams/` — per-team CLAUDE.md files
- `libs/shared/src/outbound/project/lib/github-port.ts` — the `GitHubPort` / `PullRequestsPort` the Project facade reads through (branch, commit, PR, issue, repo content). The old floor `CodePlatform`/`GitHubPlatform` were removed once floor consolidated onto this shared surface.
- `libs/shared/src/outbound/project/lib/platform-github.ts` — the single octokit adapter implementing both ports (App-or-token auth, paginated reads, `getInstallationToken`); the only production octokit importer. Floor's duplicate adapter was deleted.
- `apps/web-ui/src/lib/github.ts` — GitHub App client for web-ui (PR status fetching)
- `apps/web-ui/src/lib/api/` — the typed clients web-ui reads through. It holds **no database pool**: all 143 queries moved behind lore-api routes (#1226), `pg` is no longer a web-ui dependency, and `lore/no-sql-in-web-ui` runs at `error`. Response types are aliases over `src/lib/api/schema.d.ts`, generated from `apps/lore-api/openapi.json`
- `apps/web-ui/src/app/specs/page.tsx` — global cross-repo spec browser; reads the spec-traceability graph via `src/lib/trace-api` (`fetchAllSpecs`), renders `GlobalDocsView` linking each entry to the per-repo detail page; not the `chunks` table. Not in the sidebar nav (reachable via repo pages or direct URL)
- `apps/web-ui/src/app/specs/[...path]/page.tsx` — global spec detail view; `[...path]` catch-all reconstructs the `encodeURIComponent`-encoded file path (single segment); renders one `SpecDocument` per repo holding that path (markdown from `fetchTraceSource`, statement overlay from `fetchTraceDocument`); breadcrumb reads "Specs"; empty state instead of a 404 when the path has no graph data
- `apps/web-ui/src/app/repos/[owner]/[repo]/specs/page.tsx` — per-repo spec list via `SpecListView`, sourced from `fetchSpecSummaries`; each entry links to the per-repo detail page. Specs are projected into the graph by CI on push to `main` — no manual "add spec" write path, no `{schema}.chunks` writes
- `apps/web-ui/src/app/tasks/[id]/TaskLogs.tsx` — live Job log viewer on the task detail page
- `apps/web-ui/src/app/tasks/[id]/PRStatusCard.tsx` — live PR status card
- `libs/shared/src/lib/business-hours.ts` — IANA-TZ-aware gate used by safety crons
- **`spec-test-coverage` v3 (2026-06-02):** source of truth for spec→test links is markdown inside `spec.md` — `Statement. ([validated by name](path/to/test.ts#L42))` at end of each statement. The web UI renders them from the traceability graph: `lib/trace-api.ts` fetches the `/trace` document, `lib/trace-statement-info.ts` adapts its statements, and `SpecDetails.tsx` colors them (the parsing itself lives in `libs/shared/src/spec-{segment,link-parser}.ts`); no DB linker tables (`spec_statements` / `spec_test_links` / `spec_coverage_runs` dropped in migration 0008). Three write-paths:
  - **Authors hand-write the links** (free; just edit `spec.md`). Line anchors drift when tests are inserted above them: `npm run format` ends with `scripts/spec-links/reanchor.mjs`, which moves every `#Lnn` whose test moved (by test title, then by diff hunk) for the test files the branch changed — `--all` sweeps the whole corpus — and the CI `format` job commits the result back to the PR branch.
  - **`/lore-suggest-links`** (subscription-billed, on-demand, single-spec) — Claude Code skill that walks through the same judge pipeline locally and opens a PR against the spec's repo. See `specs/local-link-suggester/`. Subscription tokens, no API spend.
  - **`spec-upkeep`** (weekly, on the external floor, `specs/external-floor` FR14) — finds testable un-linked statements from the traceability graph and adds the links in the pull request it opens. It replaced the `spec-coverage-backfill` line, whose tick was removed on 2026-10-02.

  A broken link is caught by the `spec-links` check on the pull request that breaks it; the daily and post-ingest validate pass on Lore's own Floor was removed on 2026-10-02 (FR16.6). See `specs/spec-test-coverage/`.
- `libs/server-core/src/work/context/context-assembly.ts` — context assembly with YAML templates
- `libs/server-core/templates/` — YAML context assembly templates (default, review, implementation, research)
- `libs/shared/src/work/repo-validation/repo-validation.ts` — deterministic validation (lint/typecheck detection for Node/Go/Python/Rust)
- `apps/lore-api/src/work/repo/repo-validation-cli.ts` — CLI wrapper for validation in K8s Job pods
- `scripts/slack-app-manifest.yaml` — Slack app manifest for /lore slash command
- `libs/shared/src/work/episode-writer.ts` — shared episode writer with Haiku-driven auto-curation
- `libs/shared/src/outbound/llm/prompt-cache.ts` — `getCacheControl(jobName)` (ephemeral + optional `ttl: "1h"`), `computeCachePrefixHash` (djb2 over system + tool schemas), `analyzeCacheBreak` (in-memory per-job tracker classifying hit / first-call / prompt-changed / ttl-expired)
- `apps/stations/src/work/consolidation/consolidation.ts` — the nightly fact consolidation (pattern extraction), a stations sweep posted to by a courier; importance decay is its sibling sweep `importance-decay`
- `libs/server-core/src/outbound/session-tracker.ts` — passive session tracking (tool calls, ring buffer, exit dump)
- `evals/` — PromptFoo eval configs per team

## Test Interface (project-test-interface)

An optional, per-repo, language-neutral interface that lets a project's own
test runner be the authoritative source of test discovery + per-test
coverage, feeding the spec-traceability graph. **Zero-LLM, deterministic.**
See `specs/project-test-interface/` (+ `contracts/test-commands.md`).

**Manifest** — `.lore/test-commands.yml` (or `lore.repos.settings.test_commands`,
settings win): `list` (prints a JSON array of `{id,name,file,startLine,endLine,suite?,spec?}`
descriptors), `run` (takes one test via the `{selector}` placeholder, prints
`{passed, covered:[{file,startLine,endLine}]}` or an lcov/cobertura report),
`coverage_format` (`lcov|cobertura|json`), `cwd` (monorepo subdir). Polyglot
repos declare a list. Absent manifest → graceful fallback to pattern
detection + bulk upload. Schema/loader: `libs/shared/src/domain/test-command-manifest.ts`
(`resolveTestCommandManifest`, `decideTestInterfaceCheck`, `isManifestDeclared`).

**Ingest endpoints** (write-scope bearer auth). Each fires a fire-and-forget
`triggerAgentSpecTrace` to the coordinator's `/api/trigger/spec-trace`, which
`dispatchSpecTrace` routes by kind family: **repo-read** kinds (`specs`/`adrs`)
read the repo at the posted commit and project via `runIngestGraph`
(`projectRepoGraph`); **payload** kinds run `ingestSpecTrace` → `ingestTestReport` /
`ingestCoverageReport`. Idempotent via xid upserts; no-ops when the coordinator
env (or `LORE_DGRAPH_HTTP`) is unset. **Doc projection is CI-driven, not a
pipeline task** (ADR-023): the repo's `lore-ingest.yml` fans out one job per kind
(`matrix: [specs, adrs]`) that POSTs `ingest-graph`. Test projection is CI-driven
too — but via the portable **lore-code-trace binary**, not an mcp route. None of the
three (specs/adrs/tests) is a pipeline task.
- `POST /api/repos/:o/:r/ingest-graph` — `{kinds[], commit, force?}`. Docs-only:
  `specs`/`adrs` fire the spec-trace trigger per kind (no task); any other kind is
  rejected `400` (test projection is CI-only via the lore-code-trace binary).
  Scope `write`. `apps/lore-api/src/transport/routes/ingest/ingest-graph.ts`.
- **Test ingest = lore-api's delta route.** The `lore-code-trace` binary runs the repo's suite
  in CI and posts what changed to `POST /api/repos/:o/:r/ingest` (after reading
  `GET /api/repos/:o/:r/ingest-state`), which writes the graph. The Floor's `ci-tests`
  webhook it used to post to went with `apps/floor`. The binary parses json / lcov
  (incl. `TN:`) / cobertura to canonical ranges itself (`apps/lore-code-trace/coverage.go`) —
  the server never parses coverage.

**MCP tools** (`apps/mcp-server/src/index.ts` → `apps/mcp-server/src/transport/tools/spec-trace-tools.ts`):
`lore_list_tests` / `lore_run_test` (run the manifest commands in the **caller's local
sandbox**) and `query_trace` (live graph reads — proxies `GET /trace/document`,
formats coverage + validated_by/violated). **Trust boundary**: execution only in a trusted sandbox (local dev /
CI / agent pod); the shared GKE server refuses (`executionRefusal`
keyed on `LORE_DB_HOST`) and returns a "run in CI / locally" error.

**Local + CI orchestrator** — the `lore-code-trace` Go binary (`apps/lore-code-trace`):
loads the manifest, runs the full suite, and prints the report (or `--post`s it to
lore-api's delta route). Baked into the mcp image + served at
`GET /dist/lore-code-trace/<os>-<arch>`; each repo's `lore-tests.yml` downloads + runs it.
(Replaced the old `npm run trace:run-tests` CLI + `buildTestReport`.)

**Onboarding** — the onboarding ticket owes a suggested `.lore/test-commands.yml`
+ a per-toolchain `.github/workflows/lore-tests.yml` (authored by the `onboard`
line's agent from `LORE_TESTS_INSTRUCTION`), each only when absent; an
already-configured repo is left untouched. The web UI + `/lore-test-commands` skill surface the
canonical `TEST_COMMAND_SETUP_PROMPT` for developers to run with Claude.

> **Status:** the graph fan-out is **built and live** — `ingestTestReport`
> persists `TestChunk`/`Coverage`/`COVERS`/`validated_by`/`violated` idempotently
> (xid upserts), driven on every push to `main` by `.github/workflows/lore-tests.yml`.
> Remaining (ADR-023, `specs/test-run-trace-binding/`): the run side only sets
> `validated_by`/`violated` when a descriptor carries a `spec` anchor — derived by
> `bindDescriptorsToSpecLinks` from the inline `([validated by](test.ts#Lline))`
> links (`list-tests.mjs` resolves per-`it` lines via `resolveTestLines` first,
> since `vitest list` is line-blind). Plus surfacing the ingest result counts
> (observability) instead of discarding them.

## Agent Memory

MCP memory tools for persistent agent memory:
- **lore_write_memory** — store a key-value memory with optional TTL
- **lore_read_memory** — retrieve a memory by key (supports version history)
- **lore_delete_memory** — soft-delete a memory
- **lore_list_memories** — paginated listing of active memories
- **lore_search_memory** — semantic search across memories and facts (supports `include_invalidated` for historical queries)
- **lore_write_episode** — ingest raw text (conversation, review, observation); auto-extracts facts and updates knowledge graph
- **lore_query_graph** — query the live knowledge graph for entities and relationships
- **lore_assemble_context** — retrieve and assemble context from all sources into a structured, token-budgeted block
- **lore_agent_stats** — health, memory count, episode count, facts, searches, daily breakdown

Memory is stored in the PostgreSQL `memory` schema (tables:
`memories`, `memory_versions`, `facts`, `fact_conflicts`, `episodes`,
`entities`, `edges`, `snapshots`, `shared_pools`, `audit_log`).
File-backed fallback to `~/.lore/memory/` when DB is unavailable.

Facts have temporal validity (`valid_from`/`valid_to`), confidence
tiers (`verified`/`observed`/`inferred`/`stale`), and retrieval
metadata (`retrieval_count`, `last_retrieved_at`, `half_life_days`).
When a new fact contradicts an existing one (cosine similarity >=
0.92), the old fact is automatically invalidated and a conflict
record is stored in `memory.fact_conflicts`. Search returns only
valid facts by default and includes confidence annotations.

Episodes are raw text blobs (conversation turns, code reviews,
observations) that are passively ingested. Facts and knowledge
graph entities are automatically extracted from episodes.

The live knowledge graph (`memory.entities` + `memory.edges`)
tracks entities (services, teams, technologies) and their
relationships. Updated incrementally on every lore_write_episode call.
Replaces the static `graphrag/graph.json` for new deployments.

Fact extraction via configurable LLM (`LORE_FACT_LLM` env:
claude/gemini/ollama) breaks unstructured text into individually
searchable facts with embeddings.

Agent ID resolved from: explicit parameter, `LORE_AGENT_ID` env,
`~/.lore/agent-id` file, or auto-generated UUID.

The MCP adapter holds **no** database pool (ADR-032) — not in stdio mode, not in
the HTTP gateway — so every data operation proxies to `LORE_API_URL`:
`lore_write_memory`/`lore_read_memory`/`lore_search_memory`/`lore_delete_memory`/`lore_list_memories`
(with a `~/.lore/memory/` file fallback), `lore_write_episode`, `lore_query_graph`
(`GET /api/graph`), and `lore_agent_stats` (`GET /api/agent-stats`). Tool handlers
carry exactly one path; a leftover "requires PostgreSQL (LORE_DB_HOST not set)"
branch means the tool is dead, not gated. Local learnings are shared across the
org. AgentDB provides optional local read caching.

## Required Workflow

Every Claude Code session connected to Lore MUST follow this order:

1. **First action**: Call `lore_assemble_context` with a query describing
   the task. This loads conventions, ADRs, memories, facts, and
   graph relationships in one call. Do not skip this.

2. **Before planning or building**: Call `lore_search_memory` to check
   if the problem was already solved or if previous sessions left
   relevant learnings. Search with multiple queries — exact terms,
   likely key names (e.g. `deployment-gotchas-{date}`), and broader
   descriptions. Never assume "no memory exists" after one search.

3. **During work**: Use `lore_search_context` for patterns and history.
   Use `lore_query_graph` to understand entity relationships. Use
   `lore_create_pipeline_task` to delegate work to agents.

4. **Before session ends**: Call `lore_write_memory` with a session
   summary of decisions, corrections, and non-obvious learnings.
   Call `lore_write_episode` with raw observations for passive fact
   extraction.

This workflow is enforced via the system prompt injected by
`install.sh`. The install script configures hooks that remind
agents to follow this order.

## Developer Setup

`install.sh` runs once per machine. It configures:
- MCP server (serves context for ALL onboarded repos)
- Skills (/lore-feature, /lore-pr)
- Hooks (SessionStart syncs context, Stop captures episode)
- System prompt (enforces lore_assemble_context + lore_search_memory workflow)
- Agent ID (~/.lore/agent-id)

No per-repo install needed. The MCP server auto-detects which repo
you're in from the git remote and serves that repo's context.

## Running Locally

```bash
git clone git@github.com:re-cinq/lore.git && lore/scripts/install.sh
```

The MCP server runs locally via stdio but proxies all operations
(context, memory, pipeline, search) to the GKE backend via
`LORE_API_URL`. The backend must be running for any functionality
beyond the initial install (the install path has no offline mode).

`npm run dev-setup` (`scripts/dev-setup.sh`) is the one-time developer
bootstrap: it checks the toolchain (docker, minikube, kubectl, helm,
claude) and fills the gaps in `.env.local` — the agent LLM credential
(`claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`, so laptop runs bill a
subscription rather than org API credit; `ANTHROPIC_API_KEY` wins if both
are set), `GITHUB_TOKEN`, ghcr creds, and `LORE_STATION_BACKEND=k8s`. When
your `gcloud` login can read GCP Secret Manager it offers (never silently)
to import the ghcr pull pair and the GitHub App triple from there, so a
deployer mints no new PATs; `lore-anthropic-api-key` is deliberately never
imported, since an API key outranks the subscription token. It
is interactive and touches nothing outside the machine; all cluster
bootstrap stays in `npm start`, which is why that half can stay
unattended. Already-set values are never overwritten, so re-running is
free.

To run the full stack on your machine instead, `npm start` from the
repo root runs `scripts/dev-local.sh`: it brings up a docker Postgres
(pgvector, data persisted to the git-ignored `.lore-pgdata/`), builds
`shared`→`mcp-server`→`agent`, then runs all four components under
`concurrently` with live reload. Ports: web-ui `:3000`, mcp-server
`:3001`, agent `:8080`, Postgres `:5432`. `npm run db:up` / `db:down`
manage the Postgres container on their own; `npm run db:schema` applies
the schema DDL. `scripts/infra/setup-local-schema.sh` bootstraps the
`lore`/`lore_ui` roles, the pgvector extension, and all schemas by
shimming `kubectl`→`docker exec` so the existing `setup-*.sh` scripts
run unmodified against the container (no SQL duplication). It then
applies the `ui-helm/migrations/*.sql` incremental migrations the same
way the GKE Helm hook does — tracked in `lore.schema_migrations`,
filename order, per-file single transaction, skip-if-applied — so
migration-added tables exist locally (local dev has no Helm hook).
`npm start` runs it automatically after Postgres is ready.

Git worktrees: run `scripts/worktree-bootstrap.sh` once per worktree — it
installs `node_modules` and builds the workspace libs so `eslint`/`tsc`
resolve inside the worktree instead of escaping to the main checkout's
(possibly stale) install (#950). The `.claude/settings.json` SessionStart hook
runs it automatically, but only when the checkout has no `node_modules` yet —
first session in a fresh worktree, never again after. After editing
`libs/*/src`, rerun it yourself so package-level `tsc --noEmit` sees the fresh
types (tsc reads `dist`). **Tests never need a build**: every package's vitest
config resolves `@re-cinq/lore-*` imports to the package's `src` through
`tools/vitest/workspace-source.ts` (aliases derived from each export map), so a
change in `libs/shared` is visible to a stations test without rebuilding — the
rebuild is the 950 MB step that OOM-killed agent pods on 2026-09-13.

## GKE Deployment

Eight service workloads on GKE (one umbrella chart, `lore-platform`, spanning a namespace per subchart; the release record itself lives in the `lore-floor` namespace, which is all that is left of the Floor Lore ran itself):
- PostgreSQL + pgvector: `lore-db` namespace
- event-router (sole writer of `pipeline.events`, ADR-044): `lore-event-router` namespace
- cluster-agent (the only process holding a Kubernetes client): `lore-cluster-agent` namespace. **Every** cluster-agent registers with lore-api and CLAIMS its work — the platform's own (registered as `central`) exactly as much as a satellite. Dispatch is pull-only, so there is no unregistered mode: the process refuses to boot without `LORE_API_URL`/`LORE_CLUSTER_AGENT_REGISTRATION_TOKEN`/`LORE_CLUSTER_AGENT_NAME`, nothing is ever pushed to it, and the terminal-run handler settles a task from the reported event rather than by reading a CR back (a run may have executed in a cluster the Floor cannot reach)
- Lore API server (remote REST): `lore-api` namespace
- lore-mcp gateway (MCP over HTTP for agent pods): `lore-api` namespace
- stations (service stations, `POST /api/stations/{name}`): `lore-stations` namespace
- Web UI: `lore-ui` namespace
- ai-agent-subsystem (agent-cr controller + Agents): `ai-agents` namespace

All secrets managed by External Secrets Operator (ESO) pulling from
GCP Secret Manager. Single `terraform apply` deploys everything.
See `infra/terraform/` for the full configuration.

**Secret material is never a Terraform input.** `secrets.tf` declares the
GCP Secret Manager *containers* (`lifecycle { prevent_destroy }`) and
resolves values by *name*; ESO mirrors them into Kubernetes and
`data.google_secret_manager_secret_version.db_password` is the one
read-back. Terraform writing versions from a gitignored per-laptop
`secrets.tfvars` was a second source of truth: a stale checkout's apply
silently pushed the OLD value back up and 401'd the fleet. Rotation is
`gcloud secrets versions add` plus the restart set — see
`docs/managing-secrets.md`; seed a new environment with
`scripts/infra/seed-secrets.sh`, and guard against a rotation the pods
never read with `scripts/infra/check-secrets.sh` (compares each secret's
newest version against every consuming pod's start time; the secret→consumer
map is read from the live ExternalSecrets, not hardcoded). **Adding a new
secret** touches four places — `local.secret_names` in `secrets.tf`, an
ExternalSecret per consuming namespace in `external-secrets.tf` (five strings
to update: resource name, `metadata.name`/`target.name`, `namespace`, `secretKey`,
and `remoteRef.key`), the
`REQUIRED`/`OPTIONAL` list in `seed-secrets.sh`, and the chart's
`secretKeyRef` — and the apply MUST land before the chart change merges,
because CI helm-deploys but never runs terraform (a `secretKeyRef` with no
ExternalSecret yet = `CreateContainerConfigError` + a hung `helm --wait`).
Optional secrets get an `enable_*` bool, never an "is this variable
non-empty" check.

Deploy config lives in `terraform.tfvars` (copy from
`terraform.tfvars.example`) — identifiers, hostnames, and the `enable_*`
feature gates, nothing secret, auto-loaded so no `-var-file` is needed:

- `lore_api_url` — external URL for the MCP server API
- `lore_ui_url` — external URL for the web UI
- `lore_ui_hostname` — hostname for the UI ingress
- `github_org` — GitHub organization name

```bash
cd infra/terraform && terraform apply
```

CI workflows also require the GitHub Actions variable `GCP_PROJECT_ID`
(`gh variable set GCP_PROJECT_ID --body "your-gcp-project-id"`).

## Repo Onboarding

Add a repo to Lore via the UI (/onboard) or MCP tool (lore_onboard_repo).
Creates a PR on the target repo with CLAUDE.md, AGENTS.md, PR
template, and CI workflows. After merge, nightly ingestion picks
up the repo's content. Repos table: lore.repos.

## Task Pipeline

Tasks created via UI, MCP, or PR trigger agents on GKE.
Pipeline tools: lore_create_pipeline_task, lore_get_pipeline_status,
lore_list_pipeline_tasks, lore_cancel_task, lore_retry_task, lore_list_task_group,
lore_get_task_logs, lore_my_usage. Local runner tools: lore_run_task_locally,
lore_list_local_tasks, lore_cancel_local_task.
Task types are the rows of `lore.agent_definitions`; their shipped defaults
are `libs/shared/src/agent-defaults/<name>.md` (frontmatter = settings,
body = prompt), which lore-api seeds into the org rows at boot:

- **onboard**: runs on the external floor where one is configured (`libs/assembly-lines/src/floor-pipelines/onboard.yaml`, `specs/external-floor` FR11): lore-api creates the task already running, cuts `lore/onboard/<task8>` and starts the run; `enrol` (labels, ingest callback, verbatim workflows + templates on the branch, `libs/shared/src/work/onboard/enrol-repo.ts`) → `author` (AGENTS.md, ADRs, spec and PR template from the onboarding ticket, `onboardTicketBody`) → `open-pr` (the ONE PR, recorded as `lore.repos.onboarding_pr_url`) → `await-ci` ⇄ `fix-ci` (a human station the pr-ready-check sweep answers, `apps/stations/src/work/pr-ready-check/floor-ci-wait.ts`) → `request-review`; the `run-settled` station settles the task. With no floor, the old Floor enrols and walks `libs/assembly-lines/src/assembly-lines/onboard.yaml`


There is no `implementation` or `general` task type any more (#2328, #2329): their assembly lines, their recipes (`implementation-tdd` with them) and their `lore.agent_definitions` rows (migration 0094) are deleted. There is no default type either: creating a task with no type, or with either of those, is refused with a pointer to the implementation loop (`namedTaskType`, `libs/shared/src/domain/task-types/retired-task-types.ts`). Code is implemented from a ticket in the repository's backlog: an issue with a `priority:*` label, which a `lore` or `lore:implementation` label also gives it (`queueTicket`, `libs/shared/src/work/backlog/queue-ticket.ts`). A plan's spec-tasks run on the same loop. A free-form `lore_run_task_locally` run is tracked on the laptop only.

No task is created from a description at all since 2026-10-02 (`specs/external-floor` FR16.7): `feature-request`, `feature-finalize`, `runbook`, `review` and `gap-fill` are refused like the two above, each with where its work goes (the backlog, a plan, or the review every pull request already gets). `POST /api/task` only acts on an existing task, Slack's `/lore` keeps `retry`, and the web UI has no create-task form. `lore_create_pipeline_task` still exists and reports that refusal; its removal follows.

Work runs as a run of a line on the **external floor** (ADR-049): a pipeline
file under `libs/assembly-lines/src/floor-pipelines/` names the line, its
stations and its agents; the floor's own cluster agent runs each agent in a
pod, and Lore's stations (`apps/stations/src/`, written with
`@re-cinq/floor-station`) do the deterministic steps: open the pull request,
wait for CI, post the review, settle the task. Lore's own Floor, whose worker
dispatched one `Agent` custom resource per task and whose watcher opened the
pull request, was deleted on 2026-10-02.

**Deterministic validation** (Minions-inspired): After the agent
edits code, the runner detects repo tooling (package.json, go.mod,
pyproject.toml, Cargo.toml) and runs lint/typecheck as mandatory
pipeline stages. This happens in both local runner (`monitorTask`)
and GKE runner (`entrypoint.sh`). Validation is scoped to changed
files to avoid false positives from pre-existing issues.

**No pre-run context hydration** (removed 2026-08-28): every run starts
cold and assembles its own context. The dispatch-time `/api/context`
fetch needed `LORE_INGEST_TOKEN`, which never leaves the central
cluster, so it made a central run and a satellite run of the same
recipe open differently. The `{context}` slot every recipe declares is
now filled with the constant `CONTEXT_BOOTSTRAP`
(`libs/shared/src/domain/agents/recipe-prompt.ts`) — an instruction to call
`lore_assemble_context` first. The parameter is always present:
`renderPrompt` leaves an unmatched placeholder intact, so omitting it
would ship the literal `{context}` to the model. **The LLM template is
`{prompt}` + `{context}`, never the recipe body** (2026-09-13, #2051): the
Floor renders the recipe from the resolved `lore.agent_definitions` row
(`renderNodePrompt`, project → org → yaml) and appends the CI verdict,
failure and round hand-off blocks into the CR parameter `prompt`; the old
template rendered `{description}` and silently dropped every block. That renderer went with `apps/floor`: on the external floor a pipeline file
carries its agents' prompts inline (`libs/assembly-lines/src/floor-pipelines/`).

**Live agent MCP access**: this is the only context path now; agent *pods* get a
**live, scoped** Lore MCP for the whole run via the shared `lore-mcp` HTTP
gateway. The rendered agent recipe (`agentDefToCrds`, `libs/shared/src/outbound/project/agents/agent-crd.ts`)
carries `resources.mcp_servers: [{ name: lore, transport: http, headers_secret:
lore-mcp-auth }]` and drops `lore_create_pipeline_task`; the ai-agent-subsystem
controller renders it into `claude --mcp-config`; for a Gemini run the init merges
them into gemini-cli's user settings (`/agent/.gemini/settings.json`, subsystem v0.11.3:
the system-scope file v0.11.2 used is refused for a uid-1000 directory, so every Gemini
pod before 2026-09-23 ran with 0 tools). The pod can search
memory/context and record targeted memory throughout the run. The
gateway is reachable at a public `:443` host because the `agent-job-egress`
NetworkPolicy allows only public `:443` egress.

**Subdirectory convention rules**: `.claude/rules/*.md` files are
loaded conditionally during context assembly based on task query
keywords. All four templates include a `rules` source at priority 1.

**Slack integration**: the `/lore` slash command retries a failed task
(`/lore retry <task_id>`) and creates none. Channel-to-repo mapping in
`lore.repos.settings.slack_channel_id`. Watcher posts PR links,
issue links, and failure messages back to the originating channel
via `LORE_SLACK_BOT_TOKEN`.

**Passive memory capture**: MCP server tracks all tool calls in
memory (session-tracker.ts). On exit, dumps to
`~/.lore/last-session.json`. Stop hook POSTs to
`/api/session-summary` for automatic episode + fact extraction.
No agent cooperation needed.

**Post-task auto-curation**: After every task completion (PR created,
no-changes, failure), an episode is automatically written via
`episode-writer.ts`. For high-signal events (PRs, failures), Haiku
extracts a "lesson learned" and stores it as a memory entry
(`auto-curation/{ref}`).

**Importance-based memory decay**: Daily job scores memories 0-10
using half-life decay model (`strength = 0.5^(age / half_life_days)`).
Retrieval count and confidence tier factor into scoring. Evicts
lowest-scoring when agent exceeds 500 memories. Transitions
unretrieved facts to `stale` confidence after 30 days. Also cleans
up invalidated facts older than 30 days beyond 2000 cap.

**Automatic consolidation**: Daily job groups recent facts (7-day
lookback) by repo and calls Haiku to extract higher-level patterns.
Stored as `consolidated/{repo}/{timestamp}` memories.

**Privacy filtering**: All memory writes (episodes, memories) pass
through `sanitizeContent()` / `redactSecrets()` to strip API keys,
JWTs, private keys, connection strings, and bearer tokens before
storage in the org-wide database.

**API security**: Centralized auth in `routes.ts` — every `/api/*`
route enforces bearer token validation before dispatch. Supports
legacy single token (`LORE_INGEST_TOKEN`, full access) and per-client
scoped tokens (`pipeline.api_tokens` table with SHA-256 hashes).
Scopes: read, write, task, webhook, admin. Token management via
`/api/tokens` endpoint. Webhooks (GitHub, Slack) use their own HMAC
signature verification. Rate limiting: 30/min webhooks, 60/min task
ops, 200/min other (in-memory sliding window). 1MB body size limit.

**Job pod security**: Pods run as non-root (uid 1000), drop all
Linux capabilities, disallow privilege escalation. NetworkPolicy
restricts egress to DNS + HTTPS + internal Lore API only.

**Context freshness**: `lore_assemble_context` warns when repo context
is stale (>7 days since last ingest) or missing (first-run welcome
with suggested actions). Statusline shows `⚠ stale` indicator.
`/api/repo-status` includes `last_ingested_at` and `stale` flag.

**Cross-repo context**: Repos can link to specific other repos via
`settings.cross_repo_repos` (configured in settings UI). When
enabled, `lore_assemble_context` searches the linked repos for relevant
context. Links are bidirectional — adding repo B from repo A's
settings auto-adds repo A to repo B's list.

**Agent definitions** (`lore.agent_definitions`): per-task-type config
(`prompt`, `model`, `timeout_minutes`, `image`) resolved by name via
`project.agentDefs.resolve(name)` — `project` row (per-repo override) →
`project_id IS NULL` row (org default); there is no third layer. The org rows
are seeded at lore-api boot from `libs/shared/src/agent-defaults/*.md`
(`seedAgentDefaults`, specs/lore-agents FR26/FR27): a field still equal to the
default last seeded (`shipped_default`, migration 0086) follows a new file, an
edited field stays, a NULL one fills; `config` other than `pod_resources` always
follows the file. Change a default with a PR to its md file — prompt tuning is
never a migration. Per-repo overrides and org defaults are edited in the
`/repos/[owner]/[repo]/agents` and `/agents` UIs. A process with neither a DB
nor the API reads the files read-only through `AgentDefsFiles`.

**Progressive trust**: `settings.trust.level` controls which task
types are allowed per repo: docs (gap-fill/runbook/onboard +
feature-planning), tests (+review), implementation
(+implementation-loop/feature-request/spec-task), full (all). `onboard` is
allowed at every tier — duplicate protection lives in the onboard
route's own guard, not the trust ladder. Auto-promotes after 3
successful merges at current level. Defaults to `implementation`
for backward compatibility.

**Task groups**: `task_group_id` on pipeline tasks coordinates
multi-repo features. `lore_create_pipeline_task` accepts `group_id`.
`lore_list_task_group` tool shows all tasks in a group with completion
status. When all tasks in a group merge, a summary episode is written.

**PR outcome feedback**: `merge-check` job captures PR stats on
merge (files changed, time to merge, review comments) and writes
curated episodes. Detects closed-without-merge as rejection signal.
Tracks aggregate `outcome_stats` per repo. On merge, boosts
`half_life_days` (+5) on facts/memories that contributed to the
task's context. On rejection, penalizes (-3, min 7). Contributing
refs tracked via `pipeline.tasks.context_refs` JSONB column.

**Retrieval strengthening**: Every `lore_search_memory` call
asynchronously increments `retrieval_count`, updates
`last_retrieved_at`, and extends `half_life_days` (+2, cap 365)
on returned facts and memories. Stale facts revive to `observed`
on retrieval. Fire-and-forget — adds zero latency to search.

**Confidence tiers**: Facts carry a `confidence` column:
`verified` (human-confirmed), `observed` (episode-sourced, default),
`inferred` (memory-sourced), `stale` (unretrieved for 30+ days).
Assembled context and search results include confidence annotations.
Stale facts get a -1 importance penalty.

**Conflict surfacing**: Contradiction detection records conflicts
in `memory.fact_conflicts` before invalidating. Context assembly
prefixes `[CONFLICT]` on facts with recent (7-day) conflicts,
giving agents visibility into disputed knowledge.

**Transfer scoring**: Cross-repo context is filtered by transfer
score — portable keywords (error, pattern, gotcha, convention)
boost score, local keywords (config, deploy, url, auth, secret)
reduce it. Only facts scoring >= 0.5 pass through. Prevents
repo-specific configuration from polluting other repos.

**Production awareness**: `settings.incidents` array (populated via
`/api/webhook/incident` for PagerDuty/Opsgenie) surfaces recent
incidents in `lore_assemble_context` at priority 1.

**Developer tools**: `lore_get_task_logs` MCP tool reads a task's
execution transcript (no UI needed). `lore_my_usage` shows per-developer
token usage (today/7-day/30-day). `lore_get_ci_failures` / `lore_get_ci_job_log`
(`apps/mcp-server/src/transport/tools/ci-tools.ts`, served to agent pods too)
report what CI said about the checked-out branch — judged sha, verdict, each
failed check's annotations/steps/log tail — and one job's log tail, via
`GET /api/repos/:o/:r/ci-failures` and `/ci-jobs/:job_id/log`; a pod reads
the verdict instead of reproducing the build (run 997026f5 died at 1Gi doing that).

**Autonomous review** (opt-in per repo via `auto_review` setting): every
open pull request is reviewed by the `code-review` line on the external
floor, and a request for changes from a trusted reviewer is answered on the
pull request by `code-review-reply` (see External floor above). The Floor
watcher's own loop (a review task per pull request it opened, then an
`implementation` fix task on changes requested) was removed on 2026-10-01
with that task type. The task page's "Give Feedback" form went on 2026-10-02 with the
feature-request task type.

**Event bus** (ADR-015, ADR-044): every trigger flows through one
`pipeline.events` table. The **event-router** is its sole writer for what
comes from outside: the GitHub webhook ingress (`POST /api/events`,
HMAC-verified, mapped to `github.*` events). The **stations service** emits
the cron ticks (`cron.<job>.tick`, `libs/shared/src/work/scheduler/`) and
drains its own subscription (`apps/stations/src/events/`): a claim with
`FOR UPDATE SKIP LOCKED`, dispatch by `event_name`, retry with backoff, then
dead-letter. It also keeps the bus: the reaper that returns stuck deliveries
and the `bus-prune` and `telemetry-prune` sweeps
(`libs/shared/src/work/housekeeping/`). Lore's own Floor, which was the bus's
first consumer and scheduler, was deleted on 2026-10-02 (`specs/external-floor`
FR16); its subscription was removed by migration 0095. A tick's work is a
stations sweep (`apps/stations/src/work/*/manifest.ts` declares the event) or
a run started on the external floor. The single-operation jobs (memory TTL,
importance decay, cost syncs, consolidation) are stations sweeps posted to by
courier CronJobs (`stations-helm` `courierJobs`). The detection family
(`gap_detection`, `spec_drift`, `spec_coverage_validate`,
`spec_coverage_backfill`) is gone (FR16.6): `spec-upkeep` on the external
floor fixes drift and adds links; gap detection is to be rebuilt (#2333).

**Prompt caching on agent LLM calls**: the Anthropic provider
(`libs/shared/src/outbound/llm/anthropic-provider.ts`, behind the `Llm` abstraction) uses
`getCacheControl(jobName)` from `libs/shared/src/outbound/llm/prompt-cache.ts` to place two cache breakpoints per request —
one on the system block, one on the tool schema — so a tool-schema
edit cannot bust the system cache and vice versa. The helper returns
`{type: "ephemeral", ttl: "1h"}` for jobs in the `LORE_CACHE_1H_JOBS`
allowlist (default: `auto-curation`, `review_reactor`,
`fact-extraction`, `graph-extraction`) and `{type: "ephemeral"}` (5m)
otherwise. Special values: `none` disables 1h everywhere, `*`
enables it for every job. Eligibility is latched once at module load
to prevent mid-process toggles from busting the server-side cache.
Each call hashes (djb2) the system + tools prefix, compares to the
last call for the same `jobName`, and emits `cache hit | first-call |
break:system | break:tools | break:ttl(42m)` on the existing log
line. `response.usage.cache_*` feeds cost accounting (1.25x writes,
0.1x reads). MCP-side raw fetches (facts.ts, graph extraction) have
static prefixes below Haiku's 2048-token cache minimum so caching
there would not trigger and is not attempted. Default
`assembleContext` budget is 8K tokens (research template keeps 16K;
implementation / review / default cap at 8K); the `lore_assemble_context`
MCP tool's `max_tokens` parameter default is also 8K.

- Every task creates a GitHub Issue on the target repo (`lore-managed` label). Issues get status comments and are closed when the PR is created. The PR remains the canonical artifact; cross-reference is via the `Lore-Task: <uuid>` trailer in the PR body.
- Optional approval gates: tasks can require a human to add an `approved` label on the GitHub Issue before processing. Configured via settings UI or `lore.settings` table.

**Dark Factory mode is gone** (ADR-016 is the design record). The per-repo `lore.repos.settings.dark_factory` block, the `task_overrides` beside it, the settings route (`/api/repos/:o/:r/settings/dark-factory`), the Dark Factory tab and the notify routing were deleted on 2026-10-02 with `apps/floor`, their only reader; migration 0096 strips the block from every repo. `PUT /api/repos/:o/:r/settings` refuses a patch that carries `dark_factory`. What outlived it:
- The two-key ceremony (admin scope + an open PR labeled `dark-factory-approval` by a CODEOWNER of the repo's `CLAUDE.md`) guards an agent definition's `image` (`apps/lore-api/src/work/two-key/approval-pr.ts`).
- Trailers: every Lore-authored commit carries `Lore-Task:` (and the stage trailers where a station writes them), the audit substrate that outlived the branch-as-state resume.
- The old line definitions at `libs/assembly-lines/src/assembly-lines/*.yaml` are walked by nothing since `apps/floor` was deleted; the lines that run are the floor pipeline files beside them.
- **Run records.** `pipeline.assembly_runs` and `pipeline.station_runs` hold the runs Lore's own Floor walked, kept as history: the run page reads them through lore-api, with their turns, events and stored node logs (`specs/external-floor` FR16.9). A run on the external floor lives in the floor and is read through `@re-cinq/floor-client`.
- There is no auto-merge: merges are made by people, or by the `merge` line on the external floor for a pull request someone merged. `pipeline.audit_log` holds no `auto_merge_decision` row, because none was ever written.
