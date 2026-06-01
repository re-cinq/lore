# Implementation Plan: Lore Platform

| Field        | Value                                           |
|--------------|-------------------------------------------------|
| Feature      | Lore — Shared Context Infrastructure            |
| Branch       | 1-lore-platform                                 |
| Spec         | [spec.md](spec.md)                              |
| Constitution | [constitution.md](../../.specify/memory/constitution.md) |
| Status       | Shipped — Phases 0–6 complete with architectural pivots |
| Created      | 2026-03-25                                      |
| Updated      | 2026-06-01                                      |

## Architectural Pivots

Three major technologies were replaced during implementation. The original
plan referenced Klaus, Beads/Dolt, and Graphiti/FalkorDB. All three were
swapped for alternatives before reaching production.

| Original Plan | Replacement | ADR |
|---------------|-------------|-----|
| Klaus (GKE agent runtime) | Lore Agent service (direct Anthropic API + headless Claude Code) | ADR-007 |
| Beads (`bd` CLI) + Dolt | Pipeline tasks via PostgreSQL + GitHub Issues | ADR-009 |
| Graphiti + FalkorDB | Live knowledge graph in PostgreSQL (`memory.entities` + `memory.edges`) | — |
| Context Cores as OCI bundles | YAML context assembly templates (`mcp-server/templates/`) | — |
| `specify-cli` | `/lore-feature` skill (interactive spec loop) | — |

## Technical Context

### Stack (As Built)

| Layer              | Technology                       | Phase |
|--------------------|----------------------------------|-------|
| MCP Server         | TypeScript + `@modelcontextprotocol/sdk` | 0 |
| HTTP Transport     | Streamable HTTP on `:3000/mcp` (GKE) | 1 |
| Stdio Transport    | Local dev via stdio (selected by `MCP_TRANSPORT`) | 0 |
| Glue Scripts       | Python (`lore-gen-constitution`) | 0 |
| Settings Merge     | Node.js (`lore-merge-settings.js`) | 0 |
| Health Check       | Bash (`lore-doctor.sh`) | 0 |
| Install            | Bash (`install.sh`) | 0 |
| Platform Skills    | Markdown (`lore-feature.md`, `lore-pr.md`, `lore-init.md`) | 0 |
| PR CI Check        | GitHub Actions YAML | 0 |
| Vector Store       | PostgreSQL + pgvector (CNPG on GKE, europe-west1) | 1 |
| Embeddings         | Vertex AI `text-embedding-005` (768 dimensions) | 1 |
| Hybrid Search      | HNSW vector + BM25 keyword + Reciprocal Rank Fusion | 1 |
| Cluster Agents     | Lore Agent service on GKE (replaces Klaus) | 1 |
| Task Pipeline      | PostgreSQL `pipeline.tasks` + GitHub Issues (replaces Beads) | 1 |
| Task Execution     | LoreTask CRD + ephemeral K8s Job pods | 1 |
| Observability      | OpenTelemetry → Cloud Monitoring | 1 |
| CI Evals           | PromptFoo | 1 |
| Infrastructure     | Terraform (Helm charts for all services) | 1 |
| Context Templates  | YAML templates in `mcp-server/templates/` (replaces Context Cores) | 1 |
| Knowledge Graph    | PostgreSQL `memory.entities` + `memory.edges` (replaces Graphiti) | 2 |
| Memory System      | PostgreSQL `memory` schema — facts, episodes, entities, edges | 2 |
| Web UI             | Next.js (`web-ui/`) — pipeline status, repo onboarding | 2 |
| Slack Integration  | `/lore` slash command → pipeline tasks | 2 |
| Gap Detection      | Lore Agent `gap-detect.ts` CronJob | 2 |
| Spec Drift         | Lore Agent `spec-drift.ts` CronJob | 3 |
| Autoresearch       | Lore Agent `autoresearch.ts` CronJob | 3 |
| Memory Lifecycle   | `memory-lifecycle.ts` — importance decay + consolidation | 3 |
| Dark Factory Mode  | Per-repo opt-out of human gates; branch-as-state + workflow YAML graph | 4 |
| Lease Backend      | `pipeline.task_leases` (Postgres CTE acquire) + file-backed local | 4 |
| Workflow Executor  | `graph-executor.ts` — declarative node dispatch, resume from trailers | 4 |
| Workflow Definitions | `agent/src/workflows/*.yaml` — gap-fill, general, implementation | 4 |
| Commit Trailers    | `shared/src/commit-trailers.ts` — `Lore-Stage:`/`Lore-Iteration:`/`Lore-Task:` | 4 |
| Auto-Merge Engine  | `agent/src/jobs/auto-merge.ts` — post-retrospective squash-merge with path + trust gates | 4 |
| Dark Factory AuthZ | Two-key approval gate for privileged settings via CODEOWNERS-labeled PR | 4 |
| Web UI Theming     | Token-driven Elegant/Retro families + light/dark/auto OS sync + per-family icon sets | 5 |
| Test CI Matrix     | Per-subproject vitest matrix in `test.yml`; `dist/**` excluded from discovery | 6 |

### Key Dependencies (As Built)

| Dependency              | Purpose                          | Status |
|-------------------------|----------------------------------|--------|
| `@modelcontextprotocol/sdk` | MCP server framework          | Stable |
| CloudNativePG (CNPG)    | PostgreSQL operator + pgvector   | Production |
| Vertex AI text-embedding-005 | 768-dim embeddings          | Production |
| OpenTelemetry + Cloud Monitoring | Trace observability     | Production |
| PromptFoo               | CI eval framework                | Production |
| LoreTask CRD            | K8s custom resource for task jobs | Production |
| External Secrets Operator | GCP Secret Manager integration | Production |
| GitHub App              | Webhook auth + PR creation       | Production |

### Repository Structure (As Built)

```
re-cinq/lore/
├── CLAUDE.md
├── AGENTS.md
├── CODEOWNERS
├── adrs/
├── runbooks/
│   └── dark-factory-rollback.md   # Rollout, rollback, pilot, audit queries
├── teams/
│   ├── payments/CLAUDE.md
│   ├── platform/CLAUDE.md
│   ├── mobile/CLAUDE.md
│   └── data/CLAUDE.md
├── evals/
├── specs/
│   ├── 1-lore-platform/
│   ├── 6-dark-factory/            # Spec, plan, contracts for dark-factory mode
│   └── ...
├── shared/
│   └── src/
│       ├── dark-factory-settings.ts  # Canonical DarkFactorySettings type + resolveSettings()
│       └── commit-trailers.ts        # formatTrailers() / parseTrailers() / lastStageOnBranch()
├── mcp-server/
│   ├── src/
│   │   ├── index.ts          # MCP server entrypoint, 30+ tools
│   │   ├── routes.ts         # HTTP API route handlers (dark-factory, timeline, by-pr)
│   │   ├── context-assembly.ts
│   │   ├── dark-factory-settings.ts  # Zod schema + resolveSettings() + twoKeyFieldsTouched()
│   │   ├── dark-factory-authz.ts     # verifyApproval() — CODEOWNERS-approval-PR ceremony
│   │   ├── github-client.ts  # GitHub App + token auth
│   │   ├── local-runner.ts   # Local task runner (worktrees)
│   │   ├── session-tracker.ts
│   │   ├── repo-validation.ts
│   │   └── graph.ts          # Knowledge graph (PostgreSQL-backed)
│   ├── templates/            # YAML context assembly templates
│   └── package.json
├── agent/
│   └── src/
│       ├── platform.ts       # CodePlatform interface
│       ├── github.ts         # GitHubPlatform implementation
│       ├── worker.ts         # Job execution orchestration
│       ├── supervisor/
│       │   ├── lease.ts              # DbLeaseBackend + FileLeaseBackend
│       │   ├── graph-executor.ts     # executeGraph() — node dispatch + stage commits
│       │   ├── runner-cli.ts         # Job pod CLI entry point (LORE_DARK_FACTORY_WORKFLOW)
│       │   ├── claude-code-handler.ts # agent-node handler: spawns claude --print
│       │   ├── agent-handler.ts
│       │   ├── handlers.ts
│       │   ├── orchestrator.ts
│       │   └── index.ts
│       ├── workflow/
│       │   └── loader.ts             # Zod schema, cycle detection (DFS), reachability check
│       ├── workflows/
│       │   ├── gap-fill.yaml
│       │   ├── general.yaml
│       │   └── implementation.yaml
│       ├── lib/
│       │   ├── dark-factory.ts       # decideIssueCreate() + decideReviewMode()
│       │   ├── escalation.ts         # escalate() — needs-human-help Issue + Slack fallback
│       │   ├── path-match.ts         # allPathsMatch() minimatch wrapper
│       │   ├── notify.ts             # decideNotify() — channel-list filter
│       │   ├── audit.ts              # writeAuditLog() for pipeline.audit_log
│       │   ├── pr-body.ts            # prFooter() — Lore-Task trailer + Refs
│       │   ├── episode-writer.ts     # Shared episode writer + Haiku auto-curation
│       │   ├── prompt-cache.ts       # getCacheControl() + computeCachePrefixHash()
│       │   └── business-hours.ts     # IANA-TZ-aware gate
│       └── jobs/
│           ├── reindex.ts
│           ├── gap-detect.ts
│           ├── spec-drift.ts
│           ├── autoresearch.ts
│           ├── context-core-builder.ts
│           ├── merge-check.ts
│           ├── memory-lifecycle.ts
│           ├── loretask-watcher.ts
│           ├── review-reactor.ts
│           ├── auto-merge.ts         # evaluateAutoMerge() + evaluateAndMerge() (Phase 4)
│           ├── auto-merge-trigger.ts # (Phase 4)
│           ├── lease-reaper.ts       # 60s tick — evicts expired leases (Phase 4)
│           ├── dark-factory-baseline.ts # 30-day counter snapshot per repo (Phase 4)
│           ├── approval-check.ts     # (Phase 4)
│           ├── spec-task-executor.ts
│           ├── eval-runner.ts
│           ├── stale-task-check.ts   # Hourly stuck-task recovery (Phase 1, added later)
│           └── ttl-cleanup.ts
├── web-ui/                   # Next.js UI
│   └── src/
│       ├── app/
│       │   ├── pipeline/[id]/
│       │   │   ├── Timeline.tsx      # Vertical stage-commit timeline (Phase 4)
│       │   │   ├── TaskLogs.tsx
│       │   │   └── PRStatusCard.tsx
│       │   ├── specs/                # Global + per-repo spec browser (Phase 4)
│       │   │   ├── page.tsx
│       │   │   └── [...path]/page.tsx
│       │   ├── repos/[owner]/[repo]/specs/page.tsx
│       │   └── settings/page.tsx     # Appearance section + ThemeSwitcher (Phase 5)
│       └── lib/
│           └── theme/                # ThemeProvider, theme-core.ts, Icon component (Phase 5)
├── scripts/
│   ├── install.sh
│   ├── lore-doctor.sh
│   ├── lore-gen-constitution.py
│   ├── lore-merge-settings.js
│   └── infra/
│       ├── setup-db.sh
│       ├── setup-schedulers.sh
│       └── generate-embeddings.sh
├── .claude/
│   └── skills/
│       ├── lore-feature/
│       ├── lore-pr/
│       └── lore-init/
├── terraform/
│   └── modules/
│       ├── gke-mcp/
│       │   ├── agent-helm/values.yaml  # LORE_DARK_FACTORY_CLUSTER_ENABLED
│       │   └── loretask-crd/           # LoreTask CRD + RBAC
│       └── lore-db/          # CNPG PostgreSQL
├── docker/
│   └── claude-runner/        # Ephemeral container for K8s Job pods
└── .github/
    ├── workflows/
    │   ├── test.yml                  # Per-subproject vitest matrix (Phase 6)
    │   ├── test-integration.yml
    │   ├── pr-description-check.yml
    │   ├── ingest-context.yml
    │   ├── context-evals.yml
    │   ├── build-claude-runner.yml
    │   ├── build-ui.yml
    │   ├── build-mcp.yml
    │   ├── build-agent.yml
    │   ├── agent-review.yml
    │   ├── spec-agent.yml
    │   └── onboard-repo.yml
    └── PULL_REQUEST_TEMPLATE.md
```

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| P1: DX-First Delivery | PASS | Phase 0 delivered full DX with zero infra. |
| P2: Zero Stored Credentials | PASS | Workload Identity on GKE; External Secrets Operator for all secrets. |
| P3: PR Quality Gates | PASS | PR template + CI check deployed Phase 0 Day 1. |
| P4: Three-Command Interface | PASS | `/lore-feature`, `/lore-pr`, `/lore-init` delivered. |
| P5: Single Interface (Lore MCP) | PASS | MCP server is the only developer-facing interface. Agent tasks accessed only via MCP delegation. |
| P6: Distributed Ownership | PASS | CODEOWNERS enforced. PromptFoo evals owned by teams. |
| P7: Architecture Final | PASS | Klaus → Lore Agent and Beads → Pipeline Tasks were documented pivots via ADRs, not ad-hoc changes. |
| P8: Schema-Per-Team | PASS | PostgreSQL (CNPG) uses schema-per-team isolation. |
| P9: Agents Over Scripts | PASS | All scheduled jobs run as Lore Agent CronJob-triggered tasks, not shell scripts. |
| P10: Opt-In Data | PASS | Slack indexing opt-in per channel. PII classifier at ingest. DMs never indexed. |

## Implementation Phases

### Phase 0: Developer Experience — COMPLETE

Phase 0 delivered the full developer experience with zero infrastructure
dependency. All 35 tasks shipped.

#### What Was Built

1. **Context repository** — `re-cinq/lore` with root `CLAUDE.md`,
   per-team `CLAUDE.md` files under `teams/`, ADRs in MADR format,
   runbooks, and `CODEOWNERS`.

2. **MVP MCP server** (`mcp-server/src/index.ts`):
   - `get_context(team?)` — reads org + team CLAUDE.md from disk.
   - `get_adrs(domain?, status?)` — reads and filters ADR files.
   - `search_context(query, limit?)` — naive text search across content.
   - File-backed; no database required.

3. **`install.sh`** — single-command install that clones the lore repo,
   builds the MCP server, detects team via `git config --global lore.team`,
   runs `lore-merge-settings.js`, installs platform skills, and runs health
   checks. Idempotent.

4. **`lore-merge-settings.js`** — merges platform MCP config, env vars,
   and hooks into `~/.claude/settings.json` without overwriting personal hooks.

5. **`lore-gen-constitution.py`** — calls MCP `get_context` and `get_adrs`,
   renders `.specify/constitution.md` for use with the lore-feature skill.

6. **`lore-doctor.sh`** — health check that tests MCP server, git
   connectivity, platform hooks, and platform skills.

7. **Platform skills** — `/lore-feature` (spec-driven loop), `/lore-pr`
   (drafts PR descriptions), `/lore-init` (onboards new repos).

8. **PR quality enforcement** — `PULL_REQUEST_TEMPLATE.md` with required
   sections + `pr-description-check.yml` GitHub Action (warning mode,
   then hard fail).

9. **`AGENTS.md`** — proactive guidance for Claude Code sessions.

**Phase 0 Verification (all passed):**
- Install completes under 5 minutes on clean machine.
- `get_context("payments")` returns payments team conventions.
- `search_context("error handling")` returns relevant results.
- `lore-doctor` prints all green.
- Full loop completes under 30 minutes; developer speaks fewer than 10 words.

### Phase 1: Managed Infrastructure — COMPLETE

Phase 1 replaced the file-backed MCP server with PostgreSQL + hybrid search,
deployed the Lore Agent service (instead of the planned Klaus), and
established the task pipeline (instead of Beads).

#### Infrastructure

- **GKE cluster** (`your-gke-cluster`, `europe-west1`) — shared cluster,
  no new cluster provisioned.
- **PostgreSQL (CNPG)** — `lore-db` namespace. PostgreSQL 16 + pgvector.
  Schema-per-team isolation. HNSW indexes (m=16, ef_construction=64) for
  vector search; GIN indexes for BM25 keyword search.
- **Embeddings** — Vertex AI `text-embedding-005` (768 dimensions).
  Generated via `scripts/infra/generate-embeddings.sh`. 46 chunks seeded
  after initial `lore-init` run.
- **Workload Identity** — all GKE workloads use Workload Identity. No
  long-lived credentials.
- **External Secrets Operator (ESO)** — pulls secrets from GCP Secret
  Manager. Single `terraform apply` deploys everything.

#### Lore Agent Service (replaces Klaus)

Klaus was dropped after 8+ attempts to fix output wrapping and model
parameter rejection issues. See ADR-007.

The Lore Agent service (`lore-agent` namespace on GKE) replaced it:
- Simple tasks: direct Anthropic API calls (Haiku model).
- Complex tasks: headless Claude Code in ephemeral K8s Job pods.
- Jobs: `reindex.ts`, `gap-detect.ts`, `spec-drift.ts`, `autoresearch.ts`,
  `context-core-builder.ts`, `merge-check.ts`, `memory-lifecycle.ts`,
  `loretask-watcher.ts`.

#### LoreTask CRD

All complex tasks use the LoreTask custom resource:
1. Agent creates a LoreTask CR.
2. `loretask-controller` watches CRs and creates K8s Jobs with the
   `claude-runner` image (`docker/claude-runner/`).
3. Job pods: pre-load context via API → run Claude Code → run
   deterministic validation (lint/typecheck) → commit → push.
4. Validation failure: one retry with fix prompt. If still failing:
   mark `needs-human-help`, preserve worktree.
5. `loretask-watcher.ts` creates a PR when the Job completes.

#### Task Pipeline (replaces Beads + Dolt)

Beads was dropped due to integration complexity and the `bd` CLI becoming
unmaintained. Dolt was dropped due to instability. See ADR-009.

Pipeline tasks are now PostgreSQL-backed (`pipeline.tasks` table) with
GitHub Issues for human-visible tracking:
- Every task creates a GitHub Issue (`lore-managed` label) on the target repo.
- MCP tools: `create_pipeline_task`, `get_pipeline_status`,
  `list_pipeline_tasks`, `cancel_task`, `retry_task`.
- Task types configured in `scripts/task-types.yaml`.
- Per-client scoped API tokens with SHA-256 hashes (scopes: read, write,
  task, webhook, admin).

#### MCP Server PostgreSQL Upgrade

- `search_context` → hybrid search (HNSW vector + BM25 keyword, RRF).
- `get_context` → queries PostgreSQL `org_shared` + team schema.
- `get_adrs` → queries with status/domain filters.
- `get_file_pr_history(file_path)` added.
- Degraded-mode fallback: local files + warning if DB unreachable.
- No interface changes — `install.sh` re-run updates seamlessly.

#### Context Templates (replaces Context Cores)

Context Cores as OCI bundles were not implemented. Instead, YAML context
assembly templates in `mcp-server/templates/` (default, review,
implementation, research) configure what context is assembled and at what
priority. `context-core-builder.ts` exists in the agent but OCI promotion
is not wired.

#### Observability

- OpenTelemetry SDK integrated into the MCP server.
- Traces + metrics exported to Cloud Monitoring.
- `tracedSearch()` emits OTEL spans for every MCP retrieval call.
- Low-confidence threshold tagging as OTEL span attributes + Cloud
  Monitoring custom metric (`lore/gap_candidates`).
- Cloud Monitoring dashboards: retrieval latency p99, gap candidate rate,
  query volume per namespace.

#### PromptFoo CI Evals

- `evals/<team>/promptfooconfig.yaml` per team (5-10 cases).
- `context-evals.yml` triggered on ADR/CLAUDE.md/spec changes.
- `--assert-pass-rate 0.85` merge gate.

**Phase 1 Verification (all passed):**
- Hybrid search verified end-to-end: Workload Identity → Vertex AI
  text-embedding-005 → HNSW + BM25 → RRF ranked results.
- Query "how does the lore platform work" returns plan.md, spec.md,
  platform CLAUDE.md as top results.
- `search_context("ChargeBuilder idempotency")` returns code chunk
  (vector) + PR (keyword).
- PR changing CLAUDE.md to "store amounts as floats" fails CI.
- Cloud Monitoring shows retrieval latency p99 per namespace.
- **Note (2026-03-28):** Hybrid search is functional end-to-end but p99
  latency has not been benchmarked under load. The 200ms target remains
  aspirational until measured.

### Phase 2: Feedback Loop + Memory System — COMPLETE

Phase 2 added the memory system, web UI, Slack integration, and gap
detection. The knowledge graph was implemented in PostgreSQL rather than
Graphiti/FalkorDB.

#### Memory System

Persistent agent memory in the PostgreSQL `memory` schema:
- `memories`, `memory_versions`, `facts`, `fact_conflicts`, `episodes`,
  `entities`, `edges`, `snapshots`, `shared_pools`, `audit_log`.
- MCP tools: `write_memory`, `read_memory`, `delete_memory`,
  `list_memories`, `search_memory`, `write_episode`, `query_graph`,
  `assemble_context`, `agent_stats`.
- Facts have temporal validity (`valid_from`/`valid_to`), confidence tiers
  (`verified`/`observed`/`inferred`/`stale`), and retrieval metadata.
- Contradiction detection: cosine similarity >= 0.92 triggers automatic
  invalidation + conflict record in `memory.fact_conflicts`.
- Privacy filtering: `sanitizeContent()` / `redactSecrets()` strip API
  keys, JWTs, private keys, connection strings before storage.

#### Knowledge Graph (PostgreSQL-backed, replaces Graphiti)

Graphiti + FalkorDB were not deployed. The knowledge graph lives in
PostgreSQL (`memory.entities` + `memory.edges`):
- Entity types: Service, Team, Function, PR, ADR, Spec, Concept, Runbook.
- Typed relationships: OWNS, CALLS, IMPLEMENTS, SUPERSEDES, REFERENCES, etc.
- `query_graph` MCP tool queries the live graph.
- Updated incrementally on every `write_episode` call via `graph.ts`.
- **Not implemented**: temporal traversal (`get_entity_history`), multi-hop
  traversal via a Graphiti MCP proxy. Graph search is flat SQL, not
  traversal-based.

#### Web UI

Next.js UI (`web-ui/`) for:
- Pipeline status and task management (`/pipeline/[id]`).
- Repo onboarding (`/onboard`).
- Live Job log viewer (`TaskLogs.tsx`, polls every 5s).
- PR status card (`PRStatusCard.tsx`).

#### Slack Integration

`/lore` slash command creates pipeline tasks:
- Channel-to-repo mapping via `lore.repos.settings.slack_channel_id`.
- Watcher posts PR links, issue links, and failure messages back via
  `LORE_SLACK_BOT_TOKEN`.
- `scripts/slack-app-manifest.yaml` defines the Slack app.

#### Gap Detection

Lore Agent `gap-detect.ts` CronJob (Monday 9am UTC):
- Low-confidence retrievals tagged as OTEL span attributes and Cloud
  Monitoring custom metric (`lore/gap_candidates`) — this is the
  observability side.
- `autoresearch.ts` fetches gap signals from **Langfuse** (not Cloud
  Monitoring directly): reads low-confidence traces via `LANGFUSE_PK` /
  `LANGFUSE_SK` / `LANGFUSE_HOST` env vars. The spec (FR-8.3) references
  Langfuse; plan.md previously said Cloud Monitoring.
- Clusters by embedding similarity.
- For 3+ occurrence clusters: drafts content, opens PR to `re-cinq/lore`,
  labels `context-gap-draft`, assigns team.
- Human review required before merge.

#### Passive Memory Capture

All MCP tool calls tracked in memory via `session-tracker.ts` (500-entry
ring buffer). On exit, dumps to `~/.lore/last-session.json`. Stop hook
POSTs to `/api/session-summary` for automatic episode + fact extraction.
No agent cooperation needed. See ADR-014.

#### Progressive Trust + Repo Onboarding

- `settings.trust.level` controls allowed task types per repo.
- Auto-promotes after 3 successful merges at current level.
- Repo onboarding via UI (`/onboard`) or `onboard_repo` MCP tool.
- Creates PR on target repo with CLAUDE.md, AGENTS.md, PR template, CI.

**Phase 2 Verification (all passed):**
- `search_memory` returns relevant facts from past sessions.
- `query_graph` returns entity relationships.
- Gap detection opens PRs with specific drafted content.
- Slack `/lore` command creates tasks and posts PR links back.

### Phase 3: Self-Improvement + Memory Lifecycle — COMPLETE

Phase 3 added autoresearch, spec drift detection, and memory lifecycle
management. The planned Graphiti deployment was not completed.

#### Autoresearch Loop (ADR-010)

Lore Agent `autoresearch.ts` weekly CronJob:
- For each gap cluster from Cloud Monitoring metrics: generates 3 candidate
  additions (direct, example-based, constraint-based).
- Builds candidate context for each via `context-core-builder.ts`.
- Evaluates against PromptFoo suite.
- Best candidate promoted if score improves >= 2%.
- Failed attempts logged to Cloud Monitoring; GitHub Issue opened for manual review.
- PRs labelled `context-experiment-passed`.
- `research-charter.md` defines standing instructions for the research system.

#### Spec Drift Detection

Lore Agent `spec-drift.ts` weekly CronJob:
- Reads spec assertions, checks against code via embedding similarity on
  ingested chunks.
- Divergence > 20%: creates a `gap-fill` pipeline task for the owning team
  (not a GitHub Issue — task creation matches FR-14.2).
- Test files and generated files excluded.
- **Note**: The plan originally stated "creates GitHub Issue"; the actual
  implementation creates a `pipeline.tasks` row with `task_type = 'gap-fill'`,
  consistent with the spec (FR-14.2) and the standard pipeline task flow.

#### Memory Lifecycle (ADR-014)

Daily jobs (5 AM decay, 5:30 AM consolidation):
- **Importance decay**: scores memories 0-10 (recency, content length,
  key pattern bonuses). Evicts lowest-scoring when agent exceeds 500
  memories. Cleans invalidated facts older than 30 days beyond 2000 cap.
- **Fact consolidation**: groups recent facts (7-day lookback) by repo,
  calls Haiku to extract 1-3 higher-level patterns. Stored as
  `consolidated/{repo}/{timestamp}` memories.
- **Retrieval strengthening**: every `search_memory` call asynchronously
  increments `retrieval_count`, extends `half_life_days` (+2, cap 365).
  Stale facts revive to `observed` on retrieval.
- **PR outcome feedback**: merge boosts half_life (+5) on facts that
  contributed context; rejection penalizes (-3, min 7).

#### Post-Task Auto-Curation

After every task (PR created, no-changes, failure), an episode is written
via `episode-writer.ts`. High-signal events trigger Haiku lesson extraction
→ stored as `auto-curation/{ref}` memories. Zero agent cooperation needed.

#### Autonomous Review Loop (ADR-012)

Opt-in per repo via `auto_review` setting:
- After implementation PR, watcher creates a review LoreTask CR.
- Review Job pod: clones PR branch, reads spec + conventions, posts PR
  comments via `gh`, outputs APPROVED or CHANGES_REQUESTED.
- Changes requested (iteration < 2): new implementation LoreTask with
  feedback on the same branch.
- Changes requested (iteration >= 2): escalate to human review.

**Phase 3 Verification:**
- Autoresearch loop generates candidates, evaluates, opens PRs.
- Spec drift creates `gap-fill` pipeline tasks (not GitHub Issues — see
  FR-14.2) on divergence > 20%; each task is linked to the owning team.
- Memory decay evicts low-importance memories; consolidation produces
  higher-level patterns.
- Post-task auto-curation produces `auto-curation/*` memories after
  every task completion.

### Phase 4: Dark Factory Mode — COMPLETE

Phase 4 introduced per-repo opt-out of human gates, branch-as-state, and
declarative workflow YAML graphs (ADR-016, accepted 2026-04-28). It
supersedes the legacy looping chain across `loretask-watcher` /
`review-reactor` / `local-runner`.

#### What Was Built

**Branch-as-state (FR1)**

Every workflow phase commits with structured trailers: `Lore-Stage:`,
`Lore-Iteration:`, `Lore-Task:`, and optional `Lore-Outcome:` /
`Lore-Cost-Tokens:`. Trailers are emitted unconditionally for both
dark-mode and opt-out repos — they are the audit substrate for both
modes. `shared/src/commit-trailers.ts` exports `formatTrailers()`,
`parseTrailers()`, and `lastStageOnBranch()` used by the supervisor,
local runner, and timeline UI.

Concurrency is enforced by `pipeline.task_leases` (Postgres CTE-based
atomic acquire with takeover detection). `lease.ts` exposes `DbLeaseBackend`
for the cluster path and `FileLeaseBackend` for worktree mode. `lease-reaper.ts`
ticks every 60 s and hard-deletes leases older than 5 minutes past expiry,
writing `lease_expired` audit entries.

**Workflow YAML graph (FR2)**

`agent/src/workflows/*.yaml` — gap-fill, general, and implementation — are
the canonical task-type definitions. `agent/src/workflow/loader.ts` validates
against the Zod schema, runs DFS cycle detection (back-edges require
`iteration_max`), and checks reachability before any workflow starts.
`graph-executor.ts` (`executeGraph()`) walks the graph, dispatches per-node-type
handlers, emits stage commits, refreshes the lease on each node, and
resumes from the last `Lore-Stage:` trailer on the branch after pod death.

`runner-cli.ts` is the Job pod CLI entry point invoked by `entrypoint.sh`
when `LORE_DARK_FACTORY_WORKFLOW` is set. Exit codes are documented (0/2/3–9)
and consumed by `entrypoint.sh` to distinguish config vs. runtime errors.

`claude-code-handler.ts` is the `agent` node handler for the cluster path:
spawns `claude --print`, maps non-zero exit → `cli-nonzero` and thrown
errors → `cli-error`.

**Two-gate enablement**

Dark-factory mode is off by default. Both gates must be on to take the
cluster supervisor path:
1. Per-repo: `dark_factory.enabled = true` in repo settings.
2. Cluster: `LORE_DARK_FACTORY_CLUSTER_ENABLED=true` on the agent helm
   deployment (use `--set-string` to avoid YAML bool coercion).

Either gate off → legacy `claude --print` path.

**Settings + authZ**

`mcp-server/src/dark-factory-settings.ts` holds the Zod schema,
`resolveSettings()` defaults, and `twoKeyFieldsTouched()` for the
privileged-field gate. `dark-factory-authz.ts` implements `verifyApproval()`:
an admin-scope token + an open PR labeled `dark-factory-approval` by a
CODEOWNER of the repo's `CLAUDE.md` is required to toggle `enabled`,
change `auto_merge.paths`, or downgrade `require_*` to false.

`GET /api/repos/:o/:r/settings/dark-factory` and
`PUT /api/repos/:o/:r/settings/dark-factory` are the API endpoints
(two-key authZ on the PUT for privileged fields).

Canonical types and `resolveSettings()` also live in `@re-cinq/lore-shared`
(`shared/src/dark-factory-settings.ts`) so agent, mcp-server, and Job pod
runner share a single source.

**Auto-merge engine**

`agent/src/jobs/auto-merge.ts` exports pure `evaluateAutoMerge()` (decision)
and `evaluateAndMerge()` (end-to-end with backoff). Auto-merge runs after
`[stage:retrospective]` for in-agent tasks (gap-fill, runbook). Conditions:
green CI + bot APPROVED + all changed paths match `auto_merge.paths` glob +
repo trust ≥ `min_trust` → squash-merge. Outcome enum captures 7 deferral
reasons + `merged`. OTEL span `lore.auto_merge.decision` carries the rule trace.
Decision + rule recorded in `pipeline.audit_log` as `auto_merge_decision`.

**Dark-factory-baseline**

`dark-factory-baseline.ts` runs pre-feature to snapshot 30-day counters
(SC1/SC4/SC6 deltas) into `pipeline.dark_factory_baseline` per repo.
This pre-populates success-criteria baselines before the pilot begins.

**Supporting lib modules**

`agent/src/lib/` gained: `dark-factory.ts` (pure `decideIssueCreate()` and
`decideReviewMode()` helpers + DB-backed wrappers), `escalation.ts`
(`escalate()` — creates `needs-human-help` Issue with diagnostic, falls back
to audit-only Slack on failure), `path-match.ts` (`allPathsMatch()`
minimatch wrapper — true only when every changed path matches at least one
allowlist glob), `notify.ts` (`decideNotify()` — filters by
`dark_factory.notify` channel list), `audit.ts` (`writeAuditLog()`),
and `pr-body.ts` (`prFooter()` — `Lore-Task:` trailer + optional `Refs #N`).

**Web UI — timeline**

`web-ui/src/app/pipeline/[id]/Timeline.tsx` is a client component that
renders a vertical stage-commit timeline with node-type icons, outcome badges,
and a lease indicator. It polls `/api/pipeline/:id/timeline` every 10 s while
the task is in flight.

**Spec + runbook**

Full spec artifacts in `specs/6-dark-factory/` (spec, plan, contracts,
data-model, quickstart). `runbooks/dark-factory-rollback.md` covers rollout,
rollback, pilot procedure, and audit-log queries.

**Phase 4 Verification:**
- Dark-factory disabled: legacy `claude --print` path taken; no supervisor.
- Dark-factory enabled, cluster gate off: same legacy path even for
  `dark_factory.enabled = true` repos.
- Dark-factory enabled, cluster gate on: supervisor path taken; branch gains
  `Lore-Stage:` commits after each node.
- Pod death: new pod reads `lastStageOnBranch()` and resumes from the
  next node.
- Auto-merge: green CI + APPROVED + path match + trust → squash-merged;
  decision recorded in `pipeline.audit_log`.
- Privileged settings change without two-key approval: `403 Forbidden`.

---

### Phase 5: Web UI Theming — COMPLETE

Phase 5 replaced the single dark-only stylesheet with a two-axis
token-driven theme system (ADR-017, accepted 2026-05-29).

#### What Was Built

**Two-axis token model**

Two independent axes:
- `family ∈ {elegant, retro}` → `data-theme-family` attribute on `<html>`.
- `scheme ∈ {light, dark, auto}` → `data-color-scheme` on `<html>`.
  `auto` is resolved to a concrete `light`/`dark` before it reaches the
  DOM via the FOUC-prevention inline script. Each axis is persisted
  independently in `localStorage` (`lore-theme-family`, `lore-color-scheme`).
  Defaults: `elegant` + `auto`.

**`theme.css` — single source of truth**

All tokens live in `theme.css`, imported before `globals.css`.
Family-level blocks hold shape/type/glass tokens (`--radius*`, `--fs-*`
type scale, `--glass-blur`). Four `[data-theme-family][data-color-scheme]`
blocks hold all color tokens. No hardcoded color or font-size remains in
`src/` outside these two files. Palettes: **Elegant** (frosted glass, Inter
via `next/font/google`); **Retro** (amber CRT, sharp corners, phosphor-glow,
VT323 font — type scale bumped for VT323's small x-height).

**FOUC prevention**

`THEME_SCRIPT` (a dependency-free IIFE) runs as the first child of `<body>`,
reads `localStorage`, resolves `auto` via `matchMedia`, and sets both
`data-*` attributes before first paint. Stashes `window.__loreFamily` so
the client's first render seeds the correct family — no hydration mismatch.

**Per-family icon sets**

`<Icon name="check|warning|…"/>` maps a semantic `IconName` to a
per-family Iconify icon (`lucide:*` for Elegant, `pixelarticons:*` for Retro).
Collections registered offline from `@iconify-json/lucide` +
`@iconify-json/pixelarticons` (no network fetch). A unit test asserts both
families define the same icon names. All prior emoji/unicode glyphs replaced
by `<Icon>`.

**Switcher**

`ThemeSwitcher` lives only on `/settings` (Appearance section): a Family
text toggle and a Light/Auto/Dark square icon-only toggle as accessible radio
groups.

**Phase 5 Verification:**
- `npm test` (30 pass), `tsc --noEmit` clean, `npm run build` succeeds.
- Zero hardcoded colors, zero font-size literals, no emoji glyphs in `src/`
  outside token files (grep-verified).
- FOUC prevention: attributes set before first paint; no hydration warnings
  in React DevTools.
- Both theme families render correctly in light + dark modes.

---

### Phase 6: Testing Standards + CI — COMPLETE

Phase 6 adopted TDD methodology and added per-subproject unit-test CI
(ADR-018, accepted 2026-05-29).

#### What Was Built

**TDD methodology (Red-Green-Refactor)**

Adopted for all new code: Three Laws, one test at a time, commit-on-green,
triangulation, tests describe behaviour not implementation. Characterization
(test-after) permitted only for pre-existing code. Detailed conventions in
`specs/testing-standards/`.

**Per-subproject CI matrix (`test.yml`)**

`.github/workflows/test.yml` runs one job per subproject (`shared`,
`mcp-server`, `agent`, `web-ui`) with `fail-fast: false`. `mcp-server` and
`agent` build `@re-cinq/lore-shared` first (they import compiled output).
`web-ui` is installed in place (`npm install --prefix web-ui`) because it is
not an npm workspace. A failure names exactly which suite broke without masking
others.

**`dist/**` excluded from vitest discovery**

`agent` and `mcp-server` vitest configs now exclude `dist/**` to prevent stale
compiled copies (which resolve `dist/workflows` only inside the Docker image)
from failing the source-tree test run.

**Integration tests isolated**

`vitest.integration.config.ts` and `test-integration.yml` are separate from
the default `vitest run`. Postgres-backed integration tests do not run in the
unit matrix.

**Phase 6 Verification:**
- `test.yml` passes across all four subprojects on a clean source tree.
- `dist/**` exclusion confirmed: running `npm run build && npm test` in
  `agent/` produces a green suite (not 5 spurious failures from compiled
  copies).
- Integration tests run independently under `test-integration.yml`.

---

## Open Items

| Item | Severity | Notes |
|------|----------|-------|
| Knowledge graph temporal traversal | Medium | `get_entity_history` not implemented; graph is flat SQL (1-hop), not Graphiti traversal |
| p99 latency benchmark | Medium | Hybrid search functional but 200ms target not verified under load |
| Context Core OCI promotion | Low | `context-core-builder.ts` exists; OCI artifact push and `crane pull` in install.sh not wired |
| Graphiti + FalkorDB deployment | Low | `scripts/graphiti/ontology.yaml` exists; deployment deferred indefinitely |
| Langfuse dependency in autoresearch | Low | `autoresearch.ts` reads gap signals from Langfuse (`LANGFUSE_PK/SK/HOST`). If Langfuse is not configured, the autoresearch loop silently skips. Cloud Monitoring gap metrics (`lore/gap_candidates`) are written but not consumed by autoresearch. |
| Dark-factory pilot verification | High | T024/T029/T035/T038/T043/T046/T053 (live verification scenarios) deferred until pilot rollout (T059). Pilot gated on 3 trust-tiered repos passing SC1–SC7 thresholds across 14 days each (SC8). |
| Legacy local-runner cleanup | Low | After pilot, the legacy local-runner code paths (T058) are to be deleted. Not yet done. |
| Theme preference roaming | Low | Theme family/scheme persisted to `localStorage` only — does not roam across devices. Server persistence not planned. |

## Risk Register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Low PR description quality despite template | High | Medium | Warning period + internal comms campaign |
| CNPG PostgreSQL cold-start latency | Medium | Low | Connection pooling, PgBouncer sidecar |
| PromptFoo eval false positives | Medium | Medium | Start with high-confidence cases, tune threshold |
| Context Core OCI promotion gap | Medium | Low | Current YAML templates serve context adequately; OCI adds distribution, not quality |
| Knowledge graph depth limited without Graphiti | Medium | Low | Flat PostgreSQL graph covers most use cases; temporal traversal is Phase 3+ |
| Developer adoption friction | High | Medium | Phase 0 gate enforced; lore-doctor diagnoses issues |

## Critical Path

```
PR template (Phase 0 Day 1)
  → ingestion quality (Phase 1)
    → semantic search quality (Phase 1)
      → context eval accuracy (Phase 1)
        → gap detection value (Phase 2)
          → autoresearch loop (Phase 3)
```

PR description quality is the foundation. Without rich alternatives-rejected
sections in PRs, the ingested content is thin and gap detection finds nothing
to improve.

## Generated Artifacts

- [research.md](research.md) — technology decisions and best practices
- [data-model.md](data-model.md) — entity definitions and relationships
- [contracts/mcp-tools.md](contracts/mcp-tools.md) — MCP tool interface contracts
