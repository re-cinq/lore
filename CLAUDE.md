# Lore

Shared context infrastructure for Claude Code. One install command
gives developers full org awareness — conventions, ADRs, team patterns,
PR history, and task state.

## Architecture

**MCP server** (`mcp-server/src/index.ts` + `routes.ts`): TypeScript,
serves context to Claude Code via MCP protocol. Dual transport: stdio
for local (Phase 0), Streamable HTTP for GKE (Phase 1). Three core tools:
`lore_assemble_context`, `lore_search_context`, `lore_search_memory`. Pipeline
delegation, local task runner, and 30+ tools total.

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

**Helm charts** for K8s deployments (Lore Agent, MCP server).
Values files should have sane defaults. No hardcoded secrets — use
K8s Secrets.

**No long-lived credentials anywhere.** Workload Identity on GKE,
gcloud auth for local dev.

## Key Components

- `mcp-server/` — the MCP server (TypeScript)
- `mcp-server/src/routes.ts` — HTTP API route handlers (extracted from index.ts). Includes `/api/repos/:o/:r/settings/dark-factory` (GET/PUT, two-key authZ on privileged fields), `/api/tasks/:uuid/timeline`, `/api/tasks/by-pr/:o/:r/:n` (PR↔task resolver)
- `mcp-server/src/dark-factory-settings.ts` — Zod schema + `resolveSettings()` defaults + `twoKeyFieldsTouched()` for the privileged-field gate
- `mcp-server/src/dark-factory-authz.ts` — `verifyApproval()` runs the CODEOWNERS-approval-PR ceremony (open PR labeled `dark-factory-approval` by a CODEOWNER of the repo's `CLAUDE.md`)
- `agent/src/supervisor/lease.ts` — `DbLeaseBackend` (Postgres CTE-based atomic acquire with takeover detection) + `FileLeaseBackend` (worktree mode under `~/.lore/leases/`) sharing a `LeaseBackend` interface (FR1.6)
- `agent/src/supervisor/graph-executor.ts` — `executeGraph()` walks workflow YAML, dispatches per-node-type handlers, emits stage commits with `Lore-Stage:`/`Lore-Iteration:`/`Lore-Task:` trailers (allow-empty for non-file-changing nodes), refreshes lease per node, supports resume from last trailer on the branch
- `agent/src/workflow/loader.ts` — Zod schema for workflow YAML, cycle detection (DFS coloring; back-edges require `iteration_max`), reachability check
- `agent/src/workflows/*.yaml` — declarative workflow definitions (gap-fill, general, implementation; more extensible)
- `agent/src/jobs/auto-merge.ts` — pure `evaluateAutoMerge()` decision + `evaluateAndMerge()` end-to-end with backoff. Outcome enum captures all 7 deferral reasons + `merged`. OTEL span `lore.auto_merge.decision` carries the rule trace
- `agent/src/jobs/lease-reaper.ts` — 60s tick deletes leases >5min past expiry, writes `lease_expired` audit entries
- `agent/src/jobs/dark-factory-baseline.ts` — pre-feature 30-day counter snapshot per repo, written to `pipeline.dark_factory_baseline` for SC1/SC4/SC6 deltas
- `agent/src/lib/dark-factory.ts` — `decideIssueCreate()` and `decideReviewMode()` pure helpers + DB-backed `shouldCreateIssue()` / `resolveReviewMode()` wrappers
- `agent/src/lib/escalation.ts` — `escalate()` creates the `needs-human-help` Issue with diagnostic, branch link, contributing refs; falls back to audit-only Slack inline if Issue creation fails (3-attempt backoff)
- `agent/src/lib/path-match.ts` — `allPathsMatch()` minimatch wrapper; returns true only when **every** changed path matches at least one allowlist glob
- `agent/src/lib/notify.ts` — `decideNotify()` filters notifications by `dark_factory.notify` channel list
- `agent/src/lib/audit.ts` — `writeAuditLog()` writer for the new `pipeline.audit_log` table
- `agent/src/lib/pr-body.ts` — `prFooter()` composes the standard `Lore-Task: <uuid>` (+ optional `Refs #N`) PR-body footer used by every Lore-authored PR
- `shared/src/commit-trailers.ts` — `formatTrailers()` / `parseTrailers()` / `lastStageOnBranch()` exported via `@re-cinq/lore-shared`. Trailers are emitted unconditionally on every Lore-authored commit regardless of dark-mode setting (audit substrate for both modes)
- `web-ui/src/app/assembly-lines/[id]/Timeline.tsx` — client component, vertical stage-commit timeline with node-type icons, outcome badges, lease indicator. Polls `/api/assembly-lines/:id/timeline` every 10s while task is in flight
- `mcp-server/src/github-client.ts` — consolidated GitHub auth (App + token fallback)
- `mcp-server/src/local-runner.ts` — local task runner (worktrees, background Claude Code). Guards against pushing to the wrong repo via `validateRepoMatch(taskRepo, cwdRepo)` at spawn time; skips PR creation if `git diff --cached --name-only` is empty after stage. Task state lives in `~/.lore/local-tasks.json` only — never inside the worktree.
- `scripts/` — install.sh, lore-doctor, lore-init, glue scripts
- `scripts/infra/` — setup-db.sh, setup-schedulers.sh, generate-embeddings.sh
- `terraform/modules/gke-mcp/ui-helm/migrations/` — ordered, idempotent `NNNN_*.sql` applied to `lore-db` on every UI deploy by a `pre-install,pre-upgrade` Helm hook Job (`ui-helm/templates/migrate-{job,configmap}.yaml`), tracked in `lore.schema_migrations`, connecting as `lore` (the DB owner — no superuser needed) via the chart's `dbPasswordSecret`. Runs on both deploy paths (CI `helm upgrade` and terraform `helm_release.lore_ui`). Baseline schema still comes from `setup-*-schema.sh`; incremental changes go here.
- `scripts/agent-prompts/` — Lore Agent prompt templates for scheduled jobs (gap detection, spec drift, autoresearch, nightly reindex, etc.); ingested as context, not loaded as runtime code
- `.claude/skills/` — platform skills (lore-feature, lore-pr, lore-init)
- `terraform/modules/` — K8s manifests, Helm charts (lore-db, gke-mcp)
- `specs/` — speckit artifacts (spec, plan, tasks, research, contracts)
- `adrs/` — architecture decision records (MADR format)
- `teams/` — per-team CLAUDE.md files
- `agent/src/platform.ts` — CodePlatform interface (branch, commit, PR, issue, repo content, PR details)
- `agent/src/github.ts` — GitHubPlatform implementation (only file importing Octokit)
- `web-ui/src/lib/github.ts` — GitHub App client for web-ui (PR status fetching)
- `web-ui/src/lib/db.ts` — PostgreSQL pool + cross-schema helpers: `query`, `queryOne`, `getRepoSchema`, `getRepoSchemaAndTeam`, `queryAllChunks` (UNION ALL across all team schemas + `org_shared`)
- `web-ui/src/app/specs/page.tsx` — global cross-repo spec browser; queries all schemas via `queryAllChunks`, filters `content_type = 'spec'`, shows 50 most-recent with per-repo filter buttons; not in the sidebar nav (only reachable via repo pages or direct URL)
- `web-ui/src/app/specs/[...path]/page.tsx` — spec detail view; `[...path]` catch-all reconstructs the file path; breadcrumb label reads "Context" (differs from list page label "Specifications"); shows all chunks matching that `file_path` across all schemas
- `web-ui/src/app/repos/[owner]/[repo]/specs/page.tsx` — per-repo spec view; scoped to one team schema; includes a server action form (`addSpec`) that inserts spec chunks directly into `{schema}.chunks` with `content_type = 'spec'`; shows 30 most-recent
- `web-ui/src/app/assembly-lines/[id]/TaskLogs.tsx` — live Job log viewer (polls every 5s)
- `web-ui/src/app/assembly-lines/[id]/PRStatusCard.tsx` — live PR status card
- `agent/src/jobs/review-reactor.ts` — addresses reviewer feedback (`reviewReactorJob` = cron path, `runReviewReactorForPR` = webhook path)
- `agent/src/lib/business-hours.ts` — IANA-TZ-aware gate used by safety crons
- `apps/floor/src/delivery/health.ts` — the Floor HTTP server: `POST /api/webhook/github` (the GitHub webhook ingress, HMAC-verified, maps→inserts `github.*` events), the `/api/agent-events` NDJSON cost sink, and `/healthz`. The old `/api/trigger/*` fan-out endpoints were replaced by the event bus (`apps/floor/src/{listeners,main-loop,jobs}/`): listeners insert into `pipeline.events`, the loop dispatches to handlers. spec-coverage validate / spec-trace now run as `internal.ingest.*` event handlers (mcp-server inserts the events post-ingest via the shared `insertEvent`).
- **`spec-test-coverage` v3 (2026-06-02):** source of truth for spec→test links is markdown inside `spec.md` — `Statement. ([validated by name](path/to/test.ts#L42))` at end of each statement. The web UI parses + colors them at render time via `web-ui/src/lib/spec-coverage-derive.ts` (`segmentStatements` → `classifyByHeuristic` → `parseTestLinksInStatement`); no DB linker tables (`spec_statements` / `spec_test_links` / `spec_coverage_runs` dropped in migration 0008). Three write-paths:
  - **Authors hand-write the links** (free; just edit `spec.md`).
  - **`/lore-suggest-links`** (subscription-billed, on-demand, single-spec) — Claude Code skill that walks through the same judge pipeline locally and opens a PR against the spec's repo. See `specs/local-link-suggester/`. Subscription tokens, no API spend.
  - **`spec-coverage-backfill` cron** (`ANTHROPIC_API_KEY`-billed, weekly Mon 11:00 UTC, org-wide sweep) — finds testable un-linked statements via the v2 judge pipeline, opens a PR per spec with `proposeLinkInsertions` adding the inline parentheticals.

  Plus the validate pass via `agent/src/jobs/scheduled/spec-coverage-validate.ts` (daily + post-ingest, resolves links, files `spec-link-rot` issues on broken links). See `specs/spec-test-coverage/`.
- `mcp-server/src/context-assembly.ts` — context assembly with YAML templates
- `mcp-server/templates/` — YAML context assembly templates (default, review, implementation, research)
- `mcp-server/src/repo-validation.ts` — deterministic validation (lint/typecheck detection for Node/Go/Python/Rust)
- `mcp-server/src/repo-validation-cli.ts` — CLI wrapper for validation in K8s Job pods
- `scripts/slack-app-manifest.yaml` — Slack app manifest for /lore slash command
- `agent/src/lib/episode-writer.ts` — shared episode writer with Haiku-driven auto-curation
- `agent/src/lib/prompt-cache.ts` — `getCacheControl(jobName)` (ephemeral + optional `ttl: "1h"`), `computeCachePrefixHash` (djb2 over system + tool schemas), `analyzeCacheBreak` (in-memory per-job tracker classifying hit / first-call / prompt-changed / ttl-expired)
- `agent/src/jobs/memory-lifecycle.ts` — importance decay (eviction) + fact consolidation (pattern extraction)
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
too — `lore-tests.yml` POSTs `/test-report` + `/coverage`. None of the three
(specs/adrs/tests) is a pipeline task.
- `POST /api/repos/:o/:r/ingest-graph` — `{kinds[], commit, force?}`. Docs-only:
  `specs`/`adrs` fire the spec-trace trigger per kind (no task); any other kind is
  rejected `400` (test projection is CI-only via `/test-report` + `/coverage`).
  Scope `write`. `mcp-server/src/api/routes/ingest-graph.ts`.
- `POST /api/repos/:o/:r/test-report` — `{commit, branch, tests[], results[]}` →
  `{tests_seen, test_chunks, validated_by, coverage_nodes, covers_edges, violated}`.
  `mcp-server/src/api/routes/test-report.ts`.
- `POST /api/repos/:o/:r/coverage` — canonical JSON list `{file,startLine,endLine}[]`
  (optionally per-test grouped); LCOV (incl. `TN:` per-test attribution) and
  Cobertura accepted and normalized → `{coverage_nodes, covers_edges, files_covered}`.
  `mcp-server/src/api/routes/coverage.ts` (`parseLcov`/`parseLcovGroups`/`parseCobertura`).

**MCP tools** (`mcp-server/src/index.ts` → `mcp-server/src/spec-trace-tools.ts`):
`lore_list_tests` / `lore_run_test` (run the manifest commands in the **caller's local
sandbox**) and `query_trace` (live graph reads — proxies `GET /trace/document`,
formats coverage + validated_by/violated). **Trust boundary**: execution only in a trusted sandbox (local dev /
CI / agent pod); the shared GKE server refuses (`executionRefusal`
keyed on `LORE_DB_HOST`) and returns a "run in CI / locally" error.

**Local CLI** — `npm run trace:run-tests` (`mcp-server/src/trace-run-tests-cli.ts`):
loads the manifest, runs the full suite locally via `buildTestReport`, prints
the `/test-report` body (or `--post`s it to the API).

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
- Lore MCP server: `mcp-servers` namespace
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
that catches dropped webhook deliveries. **Carve-out:** heavy batch jobs
stay as K8s CronJobs running their work directly (ADR-019).

**Prompt caching on agent LLM calls**: `callLLM` / `callLLMWithTool`
in `agent/src/anthropic.ts` use `getCacheControl(jobName)` from
`lib/prompt-cache.ts` to place two cache breakpoints per request —
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
- Workflow definitions live as YAML files at `agent/src/workflows/*.yaml`. Local runner and GKE supervisor share definitions (FR2.3).
- Auto-merge runs after `[stage:retrospective]` for in-agent tasks (gap-fill / runbook): green CI + bot APPROVED + path matches every changed file + repo trust ≥ `min_trust` → squash-merge. Decision and rule recorded in `pipeline.audit_log` as `auto_merge_decision`.
- Rollout, rollback, pilot procedure, audit-log queries: `runbooks/dark-factory-rollback.md`.
