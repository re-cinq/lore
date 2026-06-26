# Implementation Plan: Lore Platform

| Field        | Value                                           |
|--------------|-------------------------------------------------|
| Feature      | Lore — Shared Context Infrastructure            |
| Branch       | 1-lore-platform                                 |
| Spec         | [spec.md](spec.md)                              |
| Constitution | [constitution.md](../../.specify/memory/constitution.md) |
| Status       | Shipped — Phases 0–3 complete with architectural pivots |
| Created      | 2026-03-25                                      |
| Updated      | 2026-04-13                                      |

## Architectural Pivots

Several technologies were replaced during implementation. The original
plan referenced Beads/Dolt and Graphiti/FalkorDB; both were swapped for
alternatives before reaching production. The cluster agent runtime is the
purpose-built Lore Agent service (ADR-007).

| Original Plan | Replacement | ADR |
|---------------|-------------|-----|
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
| Cluster Agents     | Lore Agent service on GKE | 1 |
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
├── teams/
│   ├── payments/CLAUDE.md
│   ├── platform/CLAUDE.md
│   ├── mobile/CLAUDE.md
│   └── data/CLAUDE.md
├── evals/
├── specs/
├── mcp-server/
│   ├── src/
│   │   ├── index.ts          # MCP server entrypoint, 30+ tools
│   │   ├── routes.ts         # HTTP API route handlers
│   │   ├── context-assembly.ts
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
│       └── jobs/
│           ├── reindex.ts
│           ├── gap-detect.ts
│           ├── spec-drift.ts
│           ├── autoresearch.ts
│           ├── context-core-builder.ts
│           ├── merge-check.ts
│           ├── memory-lifecycle.ts
│           └── loretask-watcher.ts
├── web-ui/                   # Next.js UI
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
│       ├── gke-mcp/          # MCP server Helm chart
│       │   └── loretask-crd/ # LoreTask CRD + RBAC
│       └── lore-db/          # CNPG PostgreSQL
├── docker/
│   └── claude-runner/        # Ephemeral container for K8s Job pods
└── .github/
    ├── workflows/
    │   ├── pr-description-check.yml
    │   ├── lore-ingest.yml
    │   ├── context-evals.yml
    │   └── gap-detection.yml
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
| P7: Architecture Final | PASS | The Lore Agent service (ADR-007) and the Pipeline Tasks pipeline were documented architecture decisions via ADRs, not ad-hoc changes. |
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
   - `lore_search_context(query, limit?)` — naive text search across content.
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
- `lore_search_context("error handling")` returns relevant results.
- `lore-doctor` prints all green.
- Full loop completes under 30 minutes; developer speaks fewer than 10 words.

### Phase 1: Managed Infrastructure — COMPLETE

Phase 1 replaced the file-backed MCP server with PostgreSQL + hybrid search,
deployed the Lore Agent service, and established the task pipeline (instead
of Beads).

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

#### Lore Agent Service

The Lore Agent service (`lore-agent` namespace on GKE) is the purpose-built
cluster agent runtime (ADR-007). A worker polls the `pipeline.tasks` table
and dispatches by task type:
- Simple tasks (onboard, feature-request, graph-ingest): direct Anthropic
  API calls; the worker creates the PR.
- Complex tasks (implementation, general, review): an ephemeral
  `claude-runner` Job pod created via the LoreTask CRD.
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
- MCP tools: `lore_create_pipeline_task`, `lore_get_pipeline_status`,
  `lore_list_pipeline_tasks`, `lore_cancel_task`, `lore_retry_task`.
- Task types configured in `scripts/task-types.yaml`.
- Per-client scoped API tokens with SHA-256 hashes (scopes: read, write,
  task, webhook, admin).

#### MCP Server PostgreSQL Upgrade

- `lore_search_context` → hybrid search (HNSW vector + BM25 keyword, RRF).
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
- `lore_search_context("ChargeBuilder idempotency")` returns code chunk
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
- MCP tools: `lore_write_memory`, `lore_read_memory`, `lore_delete_memory`,
  `lore_list_memories`, `lore_search_memory`, `lore_write_episode`, `lore_query_graph`,
  `lore_assemble_context`, `lore_agent_stats`.
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
- `lore_query_graph` MCP tool queries the live graph.
- Updated incrementally on every `lore_write_episode` call via `graph.ts`.
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
- Repo onboarding via UI (`/onboard`) or `lore_onboard_repo` MCP tool.
- Creates PR on target repo with CLAUDE.md, AGENTS.md, PR template, CI.

**Phase 2 Verification (all passed):**
- `lore_search_memory` returns relevant facts from past sessions.
- `lore_query_graph` returns entity relationships.
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
- **Retrieval strengthening**: every `lore_search_memory` call asynchronously
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
- Spec drift creates GitHub Issues on divergence > 20%.
- Memory decay evicts low-importance memories; consolidation produces
  higher-level patterns.
- Post-task auto-curation produces `auto-curation/*` memories after
  every task completion.

## Open Items

| Item | Severity | Notes |
|------|----------|-------|
| Knowledge graph temporal traversal | Medium | `get_entity_history` not implemented; graph is flat SQL (1-hop), not Graphiti traversal |
| p99 latency benchmark | Medium | Hybrid search functional but 200ms target not verified under load |
| Context Core OCI promotion | Low | `context-core-builder.ts` exists; OCI artifact push and `crane pull` in install.sh not wired |
| Graphiti + FalkorDB deployment | Low | `scripts/graphiti/ontology.yaml` exists; deployment deferred indefinitely |
| Langfuse dependency in autoresearch | Low | `autoresearch.ts` reads gap signals from Langfuse (`LANGFUSE_PK/SK/HOST`). If Langfuse is not configured, the autoresearch loop silently skips. Cloud Monitoring gap metrics (`lore/gap_candidates`) are written but not consumed by autoresearch. |

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
