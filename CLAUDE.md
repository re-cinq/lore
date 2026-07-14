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
  plus pipeline delegation, the local task runner, and 30+ tools total.
- **`apps/lore-api`** (`src/index.ts` + `server/http-server.ts`) — the remote
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

**TypeScript** for the MCP server. ESM modules, strict mode, ES2022
target. Zod for input validation on all MCP tools. Return errors as
text in MCP responses, never throw.

**Python** for glue scripts (lore-gen-constitution).
Keep them short (<100 lines). Handle missing tools gracefully with
clear error messages.

**Bash** for install.sh, lore-doctor, infra scripts. Must be
idempotent — safe to re-run. Prefix output with `[lore]`. Exit 0 on
success, 1 on failure.

**Helm charts** for K8s deployments. All five service workloads ship as
ONE umbrella chart, `lore-platform` (vendoring floor/lore-api/ui/lore-db/ai-agents
subcharts under `charts/`); one `helm_release.lore_platform` deploys them.
Values files should have sane defaults. No hardcoded secrets — use
K8s Secrets.

**No long-lived credentials anywhere.** Workload Identity on GKE,
gcloud auth for local dev.

## Key Components

- `mcp-server/` — the MCP server (TypeScript)
- `mcp-server/src/routes.ts` — HTTP API route handlers (extracted from index.ts). Includes `/api/repos/:o/:r/settings/dark-factory` (GET/PUT, two-key authZ on privileged fields), `/api/tasks/:uuid/timeline`, `/api/tasks/by-pr/:o/:r/:n` (PR↔task resolver)
- `mcp-server/src/dark-factory-settings.ts` — Zod schema + `resolveSettings()` defaults + `twoKeyFieldsTouched()` for the privileged-field gate
- `mcp-server/src/dark-factory-authz.ts` — `verifyApproval()` runs the CODEOWNERS-approval-PR ceremony (open PR labeled `dark-factory-approval` by a CODEOWNER of the repo's `CLAUDE.md`)
- `libs/shared/src/project/leases/lease-backends.ts` — `DbLeaseBackend` (Postgres CTE-based atomic acquire with takeover detection) + `FileLeaseBackend` (worktree mode under `~/.lore/leases/`) sharing a `LeaseBackend` interface (FR1.6)
- `libs/assembly-lines/src/transition.ts` — `nextTransition()`: the pure replay that derives the walk's next step (launch / await / finish / fail) purely from the persisted `pipeline.assembly_line_nodes` rows + the definition graph (exact edge + `iteration_max` accounting via `selectEdge`). The event-driven walk (`apps/floor/src/jobs/assembly-line/advance.ts`) is its Floor-side driver; the old in-process `executeAssemblyLine` (stage commits, branch-trailer resume, per-node lease) was retired in the cutover (spec 6-dark-factory FR6.9)
- `libs/assembly-lines/src/loader.ts` — Zod schema for assembly line YAML, cycle detection (DFS coloring; back-edges require `iteration_max`), reachability check; nodes carry optional `station_ref` (custom station image) + `timeout_minutes`, and detect nodes require `job_ref`
- `libs/assembly-lines/src/assembly-lines/*.yaml` — declarative assembly line definitions (gap-fill, general, implementation, plus the detection lines spec-drift/gap-detect/spec-coverage-{validate,backfill}; more extensible). `code-review.yaml` (`review → refine → done`) is the PR-review line: started per PR-lifecycle webhook by the code-review choreography (`apps/floor/src/jobs/review/code-review.ts`), not by a task — opened→review-pass+started-comment, human reply→`mode:reply` pass (decide-per-reply: answer or commit), closed→finish; gated on `auto_review`, bot-authored PRs/comments skipped (loop guard)
- `libs/assembly-lines/src/node-outcome.ts` — `stationNodeOutcome()` + `parseNodeResult()`/`parseReviewVerdict()` for the station contract's `LORE_NODE_RESULT` line; outcome precedence LORE_NODE_RESULT → REVIEW_RESULT → success, CR `Failed` → `<kind>-failed`. Consumed by the Floor's node-event handler + reaper (`apps/floor/src/jobs/assembly-line/`) and by the `lore-station` pods. Node-execution types (`StageOutcome`/`NodeResult`/`NodeContext`) live in `node-types.ts`. (The old `station-node-handler.ts` poll loop retired with the in-process walk.)
- `apps/lore-station/` — the station pod entrypoint image (`ghcr.io/re-cinq/lore-station`, `lore-station <type> '<station_input json>'`): runs one non-agent node per pod (validate/gate/retrospective/github_action/detect) via the subsystem's `exec` vendor. Reads/writes over HTTP through `createStationProject(repo)` (no Postgres/App creds in the pod, D7); the detector cores live in `@re-cinq/lore-shared/detect` (facade-driven, shared by Floor + station). Contract in `specs/6-dark-factory/contracts/station-contract.md`. **Cutover complete** (ADR-031 amendment): every non-agent Floor-assembly-line node dispatches a station — the `LORE_STATION_NODES` flag + in-process node handlers are gone. The last in-process execution path (the gap-fill/runbook JSON-supervisor, `processTaskViaSupervisor`) was also removed: gap-fill now runs on the Floor AssemblyLine (per-node Agent CRs, same as implementation) and runbook (no assembly-line YAML) runs as a single Agent CR — both via `handleClaudeCodeTask`, no Floor-side clone or App token. Builtin `def-<type>` recipes seeded from `scripts/task-types.yaml` `stations:` by gen-catalog + migrations 0027/0028; custom stations register via an `execution_mode: 'station'` agent-definitions row.
- `apps/floor/src/jobs/merge/auto-merge.ts` — pure `evaluateAutoMerge()` decision + `evaluateAndMerge()` end-to-end with backoff. Outcome enum captures all 7 deferral reasons + `merged`. OTEL span `lore.auto_merge.decision` carries the rule trace
- `apps/floor/src/main-loop/lease/lease-reaper.ts` — 60s tick deletes leases >5min past expiry, writes `lease_expired` audit entries
- `apps/floor/src/jobs/dark-factory/dark-factory-baseline.ts` — pre-feature 30-day counter snapshot per repo, written to `pipeline.dark_factory_baseline` for SC1/SC4/SC6 deltas
- `apps/floor/src/jobs/dark-factory/dark-factory.ts` — `decideIssueCreate()` and `decideReviewMode()` pure helpers + DB-backed `shouldCreateIssue()` / `resolveReviewMode()` wrappers
- `apps/floor/src/jobs/platform/escalation.ts` — `escalate()` creates the `needs-human-help` Issue with diagnostic, branch link, contributing refs; falls back to audit-only Slack inline if Issue creation fails (3-attempt backoff)
- `libs/shared/src/path-match.ts` — `allPathsMatch()` minimatch wrapper; returns true only when **every** changed path matches at least one allowlist glob
- `libs/shared/src/project/notify/notify.ts` — `decideNotify()` filters notifications by `dark_factory.notify` channel list
- `apps/floor/src/jobs/lib/audit.ts` — `writeAuditLog()` writer for the new `pipeline.audit_log` table
- `libs/shared/src/pr-body.ts` — `prFooter()` composes the standard `Lore-Task: <uuid>` (+ optional `Refs #N`) PR-body footer used by every Lore-authored PR
- `shared/src/commit-trailers.ts` — `formatTrailers()` / `parseTrailers()` / `lastStageOnBranch()` exported via `@re-cinq/lore-shared`. Trailers are emitted unconditionally on every Lore-authored commit regardless of dark-mode setting (audit substrate for both modes)
- `libs/shared/src/project/tasks/task-queue-{port,pg,memory}.ts` — `TaskQueueRepository`: the org-wide (repo-agnostic) `pipeline.tasks` claim/sweep mechanics single-sourced out of Floor — `claimNextPending` (worker poll, immediate-first + 30s grace), `findRecoverable`/`findStaleRunning` (crash-recovery + safety-net sweeps), `findReadySpecTasks`/`countRunningSpecTasksByGroup`/`claimSpecTask` (spec-task DAG dispatch). Pg adapter + InMemory double (the behavioral spec) + colocated tests. Repo-scoped task *record* ops stay on `project.tasks`
- `libs/shared/src/project/events/event-queue-{port,pg,memory}.ts` — `EventQueueRepository`: the `pipeline.events` consume side (`claimBatch` with `FOR UPDATE SKIP LOCKED`, `markDone`/`markFailed`/`markDead`, `reapStuck`, `pruneHandled`); `insert` delegates to the shared `events.ts insertEvent`. The Floor event **loop/registry/scheduler** stay in `apps/floor/src/main-loop/`; only the SQL moved
- `libs/shared/src/project/leases/lease-backends.ts` — `LeaseBackend` gained `reapExpired(cutoff)` (Db DELETE…RETURNING with OTEL span, File scan, `InMemoryLeaseReaper` double) so the lease-reaper goes through `project.leases` instead of a Floor-local repo
- `apps/floor/src/kernel/queues.ts` — Floor-side lazy singletons binding the agent pool to the shared `Pg…` adapters (lazy because `getPool()` requires `initPool()` first). All Floor DB access goes through these (cross-repo/no-repo jobs) or `projectFor(repo)` (repo-scoped); inline `query()` SQL was extracted into `@re-cinq/lore-shared/project/*` ports (ADR-024 "Floor data access"). Singletons: `taskQueue`/`taskStore` (pipeline.tasks queue + record ops, incl. `setStatusIf` CAS / `setColumns` / `insertTask` gate-free), `eventQueue`, `leaseBackend`, `auditLog`, `usage` (llm_calls), `settings` (lore.repos record ops), `jobRuns`, `evalRuns`, `cost`, `contextCore`, `research`, `baseline`, `chunks`, `memoryLifecycle` (memory.* decay/feedback/episodes). Deleted the Floor-local `kernel/repositories/*`. Remaining inline-SQL holdouts (chunk-content reads in spec-coverage/gap-detect/spec-drift, global lore.settings/lore.features) are a Phase-2 knowledge-read port
- `web-ui/src/app/assembly-lines/[id]/Timeline.tsx` — client component, vertical stage-commit timeline with node-type icons, outcome badges, lease indicator. Polls `/api/assembly-lines/:id/timeline` every 10s while task is in flight
- `mcp-server/src/github-client.ts` — consolidated GitHub auth (App + token fallback)
- `mcp-server/src/local-runner.ts` — local task runner (worktrees, background Claude Code). Guards against pushing to the wrong repo via `validateRepoMatch(taskRepo, cwdRepo)` at spawn time; skips PR creation if `git diff --cached --name-only` is empty after stage. Task state lives in `~/.lore/local-tasks.json` only — never inside the worktree.
- `scripts/` — install.sh, lore-doctor, lore-init, glue scripts
- `scripts/infra/` — setup-db.sh, setup-schedulers.sh, generate-embeddings.sh
- `infra/terraform/modules/gke-mcp/lore-platform/charts/ui-helm/migrations/` — ordered, idempotent `NNNN_*.sql` applied to `lore-db` on every deploy by a `pre-install,pre-upgrade` Helm hook Job (`lore-platform/charts/ui-helm/templates/migrate-{job,configmap}.yaml`), tracked in `lore.schema_migrations`, connecting as `lore` (the DB owner — no superuser needed) via the chart's `dbPasswordSecret`. Runs on both deploy paths (CI `helm upgrade` of the umbrella and terraform `helm_release.lore_platform`). The hook now fires on every umbrella upgrade regardless of which service changed; it is idempotent (skip-if-applied) so re-running on a floor/mcp deploy is a no-op. Baseline schema still comes from `setup-*-schema.sh`; incremental changes go here.
- `scripts/agent-prompts/` — Lore Agent prompt templates for scheduled jobs (gap detection, spec drift, autoresearch, nightly reindex, etc.); ingested as context, not loaded as runtime code
- `.claude/skills/` — platform skills (lore-feature, lore-pr, lore-init)
- `infra/terraform/modules/gke-mcp/lore-platform/` — the single umbrella Helm chart for all five service workloads (floor/lore-api/ui/lore-db/ai-agents subcharts under `charts/`); each subchart stamps its own namespace so one release spans them. `infra/terraform/modules/gke-mcp/` also holds the standalone bootstrap root (cluster + node pools)
- `specs/` — speckit artifacts (spec, plan, tasks, research, contracts)
- `adrs/` — architecture decision records (MADR format)
- `teams/` — per-team CLAUDE.md files
- `libs/shared/src/project/lib/github-port.ts` — the `GitHubPort` / `PullRequestsPort` the Project facade reads through (branch, commit, PR, issue, repo content). The old floor `CodePlatform`/`GitHubPlatform` were removed once floor consolidated onto this shared surface.
- `libs/shared/src/project/lib/platform-github.ts` — the single octokit adapter implementing both ports (App-or-token auth, paginated reads, `getInstallationToken`); the only production octokit importer. Floor's duplicate adapter was deleted.
- `web-ui/src/lib/github.ts` — GitHub App client for web-ui (PR status fetching)
- `web-ui/src/lib/db.ts` — PostgreSQL pool + cross-schema helpers: `query`, `queryOne`, `getRepoSchema`, `getRepoSchemaAndTeam`, `queryAllChunks` (UNION ALL across all team schemas + `org_shared`)
- `web-ui/src/app/specs/page.tsx` — global cross-repo spec browser; queries all schemas via `queryAllChunks`, filters `content_type = 'spec'`, shows 50 most-recent with per-repo filter buttons; not in the sidebar nav (only reachable via repo pages or direct URL)
- `web-ui/src/app/specs/[...path]/page.tsx` — spec detail view; `[...path]` catch-all reconstructs the file path; breadcrumb label reads "Context" (differs from list page label "Specifications"); shows all chunks matching that `file_path` across all schemas
- `web-ui/src/app/repos/[owner]/[repo]/specs/page.tsx` — per-repo spec view; scoped to one team schema; includes a server action form (`addSpec`) that inserts spec chunks directly into `{schema}.chunks` with `content_type = 'spec'`; shows 30 most-recent
- `web-ui/src/app/assembly-lines/[id]/TaskLogs.tsx` — live Job log viewer (polls every 5s)
- `web-ui/src/app/assembly-lines/[id]/PRStatusCard.tsx` — live PR status card
- `apps/floor/src/jobs/review/review-reactor.ts` — addresses reviewer feedback (`reviewReactorJob` = cron path, `runReviewReactorForPR` = webhook path)
- `libs/shared/src/business-hours.ts` — IANA-TZ-aware gate used by safety crons
- `apps/floor/src/delivery/health.ts` — the Floor HTTP server: `POST /api/webhook/github` (the GitHub webhook ingress, HMAC-verified, maps→inserts `github.*` events), the `/api/agent-events` NDJSON cost sink, and `/healthz`. The old `/api/trigger/*` fan-out endpoints were replaced by the event bus (`apps/floor/src/{listeners,main-loop,jobs}/`): listeners insert into `pipeline.events`, the loop dispatches to handlers. spec-coverage validate / spec-trace now run as `internal.ingest.*` event handlers (mcp-server inserts the events post-ingest via the shared `insertEvent`).
- **`spec-test-coverage` v3 (2026-06-02):** source of truth for spec→test links is markdown inside `spec.md` — `Statement. ([validated by name](path/to/test.ts#L42))` at end of each statement. The web UI parses + colors them at render time via `web-ui/src/lib/spec-coverage-derive.ts` (`segmentStatements` → `classifyByHeuristic` → `parseTestLinksInStatement`); no DB linker tables (`spec_statements` / `spec_test_links` / `spec_coverage_runs` dropped in migration 0008). Three write-paths:
  - **Authors hand-write the links** (free; just edit `spec.md`).
  - **`/lore-suggest-links`** (subscription-billed, on-demand, single-spec) — Claude Code skill that walks through the same judge pipeline locally and opens a PR against the spec's repo. See `specs/local-link-suggester/`. Subscription tokens, no API spend.
  - **`spec-coverage-backfill`** (`ANTHROPIC_API_KEY`-billed, weekly Mon 11:00 UTC via `cron.spec_coverage_backfill.tick` → one per-repo assembly line; ADR-019 amendment) — finds testable un-linked statements via the v2 judge pipeline, opens a PR per spec with `proposeLinkInsertions` adding the inline parentheticals.

  Plus the validate pass via `apps/floor/src/jobs/spec-trace/spec-coverage-validate.ts` (daily + post-ingest, resolves links, files `spec-link-rot` issues on broken links). See `specs/spec-test-coverage/`.
- `mcp-server/src/context-assembly.ts` — context assembly with YAML templates
- `mcp-server/templates/` — YAML context assembly templates (default, review, implementation, research)
- `mcp-server/src/repo-validation.ts` — deterministic validation (lint/typecheck detection for Node/Go/Python/Rust)
- `mcp-server/src/repo-validation-cli.ts` — CLI wrapper for validation in K8s Job pods
- `scripts/slack-app-manifest.yaml` — Slack app manifest for /lore slash command
- `apps/floor/src/jobs/lib/episode-writer.ts` — shared episode writer with Haiku-driven auto-curation
- `libs/shared/src/llm/prompt-cache.ts` — `getCacheControl(jobName)` (ephemeral + optional `ttl: "1h"`), `computeCachePrefixHash` (djb2 over system + tool schemas), `analyzeCacheBreak` (in-memory per-job tracker classifying hit / first-call / prompt-changed / ttl-expired)
- `apps/floor/src/jobs/memory/memory-lifecycle/memory-lifecycle.ts` — importance decay (eviction) + fact consolidation (pattern extraction)
- `mcp-server/src/session-tracker.ts` — passive session tracking (tool calls, ring buffer, exit dump)
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
detection + bulk upload. Schema/loader: `shared/src/test-command-manifest.ts`
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
  Scope `write`. `mcp-server/src/api/routes/ingest-graph.ts`.
- **Test ingest = the Floor `ci-tests` hook** (the old mcp `/test-report` + `/coverage`
  routes were removed in the cutover). The `lore-code-trace` binary runs the repo's suite
  in CI and POSTs `{repo, commit, branch, tests[], results[]}` to `POST /api/webhook/ci-tests`
  on the Floor server (`apps/floor/src/listeners/ci-tests.ts`, bearer `LORE_INGEST_TOKEN`),
  which emits `internal.ingest.spec_trace` (kind `test-report`) → `ingestTestReport`. The
  binary parses json / lcov (incl. `TN:`) / cobertura to canonical ranges itself
  (`apps/lore-code-trace/coverage.go`) — the server never parses coverage.

**MCP tools** (`mcp-server/src/index.ts` → `mcp-server/src/spec-trace-tools.ts`):
`lore_list_tests` / `lore_run_test` (run the manifest commands in the **caller's local
sandbox**) and `query_trace` (live graph reads — proxies `GET /trace/document`,
formats coverage + validated_by/violated). **Trust boundary**: execution only in a trusted sandbox (local dev /
CI / agent pod); the shared GKE server refuses (`executionRefusal`
keyed on `LORE_DB_HOST`) and returns a "run in CI / locally" error.

**Local + CI orchestrator** — the `lore-code-trace` Go binary (`apps/lore-code-trace`):
loads the manifest, runs the full suite, and prints the report (or `--post`s it to the
Floor `ci-tests` ingress). Baked into the mcp image + served at
`GET /dist/lore-code-trace/<os>-<arch>`; each repo's `lore-tests.yml` downloads + runs it.
(Replaced the old `npm run trace:run-tests` CLI + `buildTestReport`.)

**Onboarding** — the `onboard` task runs a test-interface check
(`decideTestInterfaceCheck`): when no manifest is declared it scaffolds a
suggested `.lore/test-commands.yml` + a per-toolchain `.github/workflows/lore-tests.yml`
(generated from `LORE_TESTS_INSTRUCTION`) in the PR; an already-configured
repo is left untouched. The web UI + `/lore-test-commands` skill surface the
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
claude/openai/ollama) breaks unstructured text into individually
searchable facts with embeddings.

Agent ID resolved from: explicit parameter, `LORE_AGENT_ID` env,
`~/.lore/agent-id` file, or auto-generated UUID.

When the MCP server runs locally (stdio mode, no `LORE_DB_HOST`), the
memory operations proxy to the GKE MCP server via `LORE_API_URL`:
`lore_write_memory`/`lore_read_memory`/`lore_search_memory`/`lore_delete_memory`/`lore_list_memories`
(with a `~/.lore/memory/` file fallback), `lore_write_episode`, and `lore_query_graph`
(reads `GET /api/graph`). `lore_agent_stats` is still DB-only. Local learnings
are shared across the org. AgentDB provides optional local read caching.

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

## GKE Deployment

Four services on GKE:
- PostgreSQL + pgvector: `lore-db` namespace
- Lore Agent: `lore-agent` namespace
- Lore API server (remote REST): `lore-api` namespace
- ai-agent-subsystem (agent-cr controller + Agents): `ai-agents` namespace

All secrets managed by External Secrets Operator (ESO) pulling from
GCP Secret Manager. Single `terraform apply` deploys everything.
See `terraform/` for the full configuration.

Deploy requires `secrets.tfvars` (copy from `secrets.tfvars.example`)
plus four variables passed on the command line or in the file:

- `lore_api_url` — external URL for the MCP server API
- `lore_ui_url` — external URL for the web UI
- `lore_ui_hostname` — hostname for the UI ingress
- `github_org` — GitHub organization name

```bash
cd terraform && terraform apply \
  -var-file=secrets.tfvars \
  -var='lore_api_url=https://lore-api.example.com' \
  -var='lore_ui_url=https://lore.example.com' \
  -var='lore_ui_hostname=lore.example.com' \
  -var='github_org=your-github-org'
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
Task types configured in
scripts/task-types.yaml:

- **feature-request**: PM describes intent in plain language → agent generates spec.md, data-model.md, tasks.md following repo conventions. Opens a PR for engineer review.
- **onboard**: inspects repo, generates CLAUDE.md, AGENTS.md, ADRs, spec, CI workflows
- **general**: open-ended task with Lore context
- **runbook**: generates incident runbook
- **implementation**: implements from a spec file
- **gap-fill**: drafts missing documentation
- **review**: reviews a PR against conventions

Agent creates branch + PR when done. Simple tasks use direct
Anthropic API calls. Implementation and review tasks run on the
**ai-agent-subsystem** (agent-cr, ADR-031):

1. The Floor worker dispatches an `Agent` custom resource (or, for task
   types with a workflow, the Floor-side AssemblyLine graph: one Agent
   CR per node)
2. The external ai-agent controller runs the Agent (Claude + prompt) in
   its own pod: pre-loads context via API → runs → deterministic
   validation (lint/typecheck) → commit → push
3. If validation fails: one retry with fix prompt → if still fails,
   mark `needs-human-help` (no PR created)
4. The `agent_watcher` job creates a PR when the Agent completes
5. Floor deploys do NOT affect running Agents — tasks survive rollout
   restarts

**Deterministic validation** (Minions-inspired): After the agent
edits code, the runner detects repo tooling (package.json, go.mod,
pyproject.toml, Cargo.toml) and runs lint/typecheck as mandatory
pipeline stages. This happens in both local runner (`monitorTask`)
and GKE runner (`entrypoint.sh`). Validation is scoped to changed
files to avoid false positives from pre-existing issues.

**Pre-run context hydration**: Before spawning Claude Code, both
runners fetch assembled context from the Lore API (`/api/context`
with `query` param). The agent starts with conventions, ADRs,
memories, and graph on turn 1 instead of spending its first action
calling `lore_assemble_context`.

**Subdirectory convention rules**: `.claude/rules/*.md` files are
loaded conditionally during context assembly based on task query
keywords. All four templates include a `rules` source at priority 1.

**Slack integration**: `/lore [task_type] description` slash command
creates pipeline tasks. Channel-to-repo mapping in
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

**Per-repo customization**: `settings.task_overrides` allows per-repo
overrides for any task type: `model`, `timeout_minutes`,
`system_prompt_suffix`, `review_required`. Merged with global
`task-types.yaml` at task creation time. Repo overrides win.

**Agent definitions** (`lore.agent_definitions`): per-task-type config
(`prompt`, `model`, `timeout_minutes`, `image`) resolved by name via
`project.agentDefs.resolve(name)` — `project` row (per-repo override) →
`project_id IS NULL` row (org default) → `task-types.yaml`/code. Edited in
the `/agents` UI. `feature-planning` is a first-class agent here: its prompt
is the `PLANNING_INSTRUCTIONS` constant (the offline/code fallback, served by
`AgentDefsYaml`) and the org-default row's prompt is seeded from it by
migration `0018`; both `runner-cli` and `handle-feature-planning` resolve it
by name rather than hardcoding.

**Progressive trust**: `settings.trust.level` controls which task
types are allowed per repo: docs (gap-fill/runbook), tests (+review),
implementation (+implementation/feature-request/general), full (all).
Auto-promotes after 3 successful merges at current level. Defaults
to `implementation` for backward compatibility.

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

**Developer tools**: `lore_get_task_logs` MCP tool reads task logs from
GCS (no UI needed). `lore_my_usage` shows per-developer token usage
(today/7-day/30-day).

**Autonomous review loop** (opt-in per repo via `auto_review` setting):
- After implementation PR is created, watcher auto-creates a review
  task (a review Agent on the ai-agent-subsystem)
- The review Agent clones the PR branch, reads spec + conventions,
  posts PR comments via `gh`, outputs APPROVED or CHANGES_REQUESTED
- Approved: task marked reviewed, PR ready for human merge
- Changes requested (iteration < 2): new implementation task
  with feedback on the same branch
- Changes requested (iteration >= 2): escalate to human review

**Event bus — the 3-layer trigger substrate** (ADR-015 amendment;
`apps/floor/src/{listeners,main-loop,jobs}/`): every Floor trigger flows through one
`pipeline.events` table (migration 0023). **Layer 1 — listeners** only
write rows: the GitHub webhook ingress moved into the Floor
(`POST /api/webhook/github`, HMAC-verified, maps to `github.*` events); a
Kubernetes watch on Agent CRs emits `kubernetes.agent.{succeeded,failed}`
on terminal phase (replacing the polled `agent_watcher`, with a reconcile
cron as the dropped-event safety net); the in-process scheduler emits
`cron.<job>.tick`; mcp-server's post-ingest triggers insert
`internal.ingest.*` (was `POST /api/trigger/*`). **Layer 2 — the loop**
atomically claims runnable rows (`FOR UPDATE SKIP LOCKED`), dispatches by
`event_name` via the registry, retry/backoff → dead-letter + a stuck-row
reaper. **Layer 3 — tasks/jobs** are the existing handlers (review-reactor,
auto-merge, agent-watcher `processAgentCr`, the cron jobs, spec-trace/
coverage, issue-dispatch, spec-PR-merge). The `review_reactor` business-hours
safety cron (`7 7-17 * * 1-5` UTC, gated by `isBusinessHours()` reading
`LORE_BUSINESS_HOURS_{TZ,START,END}` / `LORE_BUSINESS_DAYS`; default
Europe/Berlin 9-18 Mon-Fri) becomes a `cron.review_reactor.tick` emitter
that catches dropped webhook deliveries. **Carve-out (ADR-019, amended
2026-07):** heavy batch jobs (reindex/eval/core-builder/memory/cost-sync) stay
as K8s CronJobs running their work directly. The detection family
(`gap_detection`, `spec_drift`, `spec_coverage_validate`,
`spec_coverage_backfill`) left the carve-out: each is an assembly-line
definition with a deterministic `detect` node
(`libs/assembly-lines/src/assembly-lines/*.yaml`); its `cron.<job>.tick`
emitter's handler (`apps/floor/src/jobs/detect/fan-out.ts`) pre-creates a
`pipeline.job_runs` row per repo (named `<job>:<repo>`) and starts one
per-repo assembly line via `assemblyLines().start()` with
`args.job_run_id` + branch `detect/<definition>/<repo>` (the overlap-guard
key). Detection lines ride the standard event-driven walk — their `detect`
node is a station CR like any other; `advanceLine` closes the job_run at
the terminal state. Manual trigger: insert the tick event with optional
`{"repo": "..."}` params.

**Prompt caching on agent LLM calls**: the Anthropic provider
(`libs/shared/src/llm/anthropic-provider.ts`, behind the `Llm` abstraction) uses
`getCacheControl(jobName)` from `libs/shared/src/llm/prompt-cache.ts` to place two cache breakpoints per request —
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

- Every task creates a GitHub Issue on the target repo (`lore-managed` label). Issues get status comments and are closed when the PR is created. **Dark-factory mode (per ADR-016) narrows this**: when `dark_factory.enabled = true`, Issues are created only for approval-gated tasks, on-the-fly escalations (`needs-human-help`), or repos that explicitly opted into `create_issue: always`. The PR remains the canonical artifact; cross-reference is via the `Lore-Task: <uuid>` trailer in the PR body.
- Optional approval gates: tasks can require a human to add an `approved` label on the GitHub Issue before processing. Configured via settings UI or `lore.settings` table.

**Dark Factory mode** (per-repo, off by default; ADR-016):
- `lore.repos.settings.dark_factory` block: `enabled`, `create_issue`, `auto_merge.{paths,min_trust,require_*}`, `review`, `notify`. Schema in `mcp-server/src/dark-factory-settings.ts`; defaults in `resolveSettings()`. Canonical types + resolver live in `@re-cinq/lore-shared` (`shared/src/dark-factory-settings.ts`) so floor + mcp-server share one source.
- **Enablement.** Per-repo `dark_factory.enabled = true` turns on dark mode for impl/general/review tasks. All tasks execute on the ai-agent-subsystem (agent-cr); the legacy LoreTask path and its cluster gate were removed (ADR-031).
- Privileged changes (`enabled` toggle, `auto_merge.paths`, downgrade of `require_*` to false) need two-key authorization: admin scope + an open PR labeled `dark-factory-approval` by a CODEOWNER of the repo's `CLAUDE.md` (`dark-factory-authz.ts`).
- Branch-as-state: every workflow phase commits with `Lore-Stage:`/`Lore-Iteration:`/`Lore-Task:` trailers; the supervisor reads `git log` to resume after pod death.
- Assembly line definitions live as YAML files at `libs/assembly-lines/src/assembly-lines/*.yaml`, executed only by the Floor today (the mcp-server local runner spawns Claude Code directly and does not load them — FR2.3's shared-interpretation goal is aspirational until the local runner adopts the library).
- **Assembly line identity + start API** (migration 0025): every execution gets a per-attempt uuid in `pipeline.assembly_lines` (+ `pipeline.assembly_line_nodes` per node: iteration, outcome, Agent CR name, stage-commit sha). `project.assemblyLines.start(definitionName, { taskId, branch, args })` persists the row and the `assembly_line.start` event in one atomic CTE and returns the id; the Floor event loop claims the event (`start-event-handler.ts` — the sole executor entry: unknown definition → row failed, no retry; detect-shaped definitions → the repo-less detect runner, everything else → the Floor AssemblyLine) and fire-and-backgrounds the walk. Agent CR names key per attempt (`<assemblyLineId:8>-<nodeId>`); stage commits carry `Lore-Assembly-Line:` alongside `Lore-Task:`. `assembly_line.*` is the one subject-first event family (multiple producers, `source: internal`).
- Auto-merge runs Floor-side after the `retrospective` node completes (the retrospective station writes the episode; merge authority never rides in a pod): green CI + bot APPROVED + path matches every changed file + repo trust ≥ `min_trust` → squash-merge. Decision and rule recorded in `pipeline.audit_log` as `auto_merge_decision`.
- Rollout, rollback, pilot procedure, audit-log queries: `runbooks/dark-factory-rollback.md`.
