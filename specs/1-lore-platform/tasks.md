# Tasks: Lore Platform

| Field   | Value                                |
|---------|--------------------------------------|
| Feature | Lore — Shared Context Infrastructure |
| Branch  | 1-lore-platform                      |
| Plan    | [plan.md](plan.md)                   |
| Spec    | [spec.md](spec.md)                   |
| Created | 2026-03-25                           |
| Updated | 2026-04-20 (spec drift reconciliation — ADR-015 + deferred tasks) |

> **Architecture note:** Several foundational decisions changed after the original tasks were written.
> ADR-007 replaced Klaus with the purpose-built **Lore Agent** service.
> ADR-009 replaced Beads/`bd` CLI and Dolt with **pipeline task MCP tools**.
> ADR-011 introduced the **LoreTask CRD** for ephemeral Claude Code execution.
> ADR-015 replaced the 5-min polling cron with a webhook-driven review reactor, added prompt
> caching on agent LLM calls, and reduced default context budgets from 16K → 8K tokens.
> T066 and T067 (Graphiti/FalkorDB) are permanently deferred — the PostgreSQL live knowledge
> graph (ADR-010) supersedes them.
> Tasks below reflect actual implementation.

## User Story Map

| Story | Spec Scenario                | Priority | Delivery Phase |
|-------|------------------------------|----------|----------------|
| US1   | First-Time Setup             | P1       | Phase 0 Day 1-2 |
| US2   | Morning Orientation          | P1       | Phase 0 Day 2-3 |
| US3   | Starting a New Feature       | P2       | Phase 0 Day 3   |
| US4   | Opening a Pull Request       | P2       | Phase 0 Day 3   |
| US5   | Context Quality Enforcement  | P2       | Phase 0 Day 1 + Phase 1 |
| US6   | Semantic Context Search      | P3       | Phase 1         |
| US7   | Cluster Delegation           | P3       | Phase 1 (via LoreTask CRD) |
| US8   | Automated Gap Detection      | P4       | Phase 2         |
| US9   | Knowledge Graph Traversal    | P5       | Phase 3         |

---

## Phase 1: Setup

- [x] T001 Initialize `re-cinq/lore` GitHub repository with README, .gitignore, and LICENSE
- [x] T002 Create repository directory structure per plan.md in re-cinq/lore/
- [x] T003 [P] Initialize MCP server project with package.json and tsconfig.json in mcp-server/
- [x] T004 [P] Create .github/PULL_REQUEST_TEMPLATE.md with required sections (Why, Approach, Alternatives Rejected, ADR References, Spec)

---

## Phase 2: Foundational — Context Content

These tasks create the context content that all user stories depend on.

### Goal
Populate the context repository with real organizational knowledge
so the MCP server has content to serve and all downstream tools
have context to work with.

- [x] T005 Write root CLAUDE.md with architecture contracts, code conventions, and key service descriptions (under 2 pages) in re-cinq/lore/CLAUDE.md
- [x] T006 [P] Write payments team conventions including ADR-042 minor units, PCI scope, and idempotency patterns in re-cinq/lore/teams/payments/CLAUDE.md
- [x] T007 [P] Write platform team conventions in re-cinq/lore/teams/platform/CLAUDE.md
- [x] T008 [P] Write mobile team conventions in re-cinq/lore/teams/mobile/CLAUDE.md
- [x] T009 [P] Write data team conventions in re-cinq/lore/teams/data/CLAUDE.md
- [x] T010 [P] Write ADR-042 (monetary amounts in minor units) in MADR format with YAML frontmatter in re-cinq/lore/adrs/ADR-042-minor-units.md
- [x] T011 [P] Write second real ADR in MADR format with YAML frontmatter in re-cinq/lore/adrs/
- [x] T012 [P] Write third real ADR in MADR format with YAML frontmatter in re-cinq/lore/adrs/
- [x] T013 [P] Write runbook for stripe webhook failure incident in re-cinq/lore/runbooks/payments-service-stripe-webhook-failure.md
- [x] T014 [P] Write second runbook from real incident in re-cinq/lore/runbooks/
- [x] T015 Create CODEOWNERS with ownership boundaries (root CLAUDE.md -> platform-eng + tech-leads, teams/ -> respective teams, adrs/ -> arch-group) in re-cinq/lore/CODEOWNERS

---

## Phase 3: US1 — First-Time Setup [P1]

### Story Goal
A new developer runs one install command and has a fully configured
Claude Code environment with org context loaded in under 5 minutes.

### Independent Test Criteria
- `install.sh` completes on clean macOS/Linux machine in < 5 minutes.
- `lore-doctor` reports all green.
- Re-running `install.sh` is idempotent — no errors, no side effects.
- Claude Code opens with MCP server configured and context available.

### Tasks

- [x] T016 [US1] Implement MVP MCP server with get_context, get_adrs, and search_context tools (~80 lines) in mcp-server/src/index.ts
- [x] T017 [US1] Add Dockerfile for MCP server (ghcr.io/re-cinq/lore-mcp:latest), supports stdio (local) and HTTP (:3000/mcp, GKE) transport via MCP_TRANSPORT env var
- [x] T018 [US1] Write lore-merge-settings.js that reads existing ~/.claude/settings.json and merges platform MCP config, env vars, and hooks without overwriting personal hooks (~40 lines) in scripts/lore-merge-settings.js
- [x] T019 [US1] Write lore-doctor.sh health check that tests MCP server, get_context, git connectivity, hooks, and skills — prints pass/fail with fix instructions in scripts/lore-doctor.sh
- [x] T020 [US1] Write install.sh: clone repo, build MCP server, detect team, run lore-merge-settings.js, install skills, run lore-doctor — idempotent, works without pre-clone in scripts/install.sh
- [x] T021 [US1] Write AGENTS.md with proactive guidance instructions (first session greeting, orientation, feature start, delegation, task tracking) in re-cinq/lore/AGENTS.md

---

## Phase 4: US2 — Morning Orientation [P1]

### Story Goal
Developer opens Claude Code and context sync happens automatically.
Unblocked tasks surface without manual action.

### Independent Test Criteria
- SessionStart hook pulls context repo silently.
- PostToolUse hook marks claimed task in-progress on file edit.
- Stop hook reminds about open claimed tasks.
- Claude Code answers convention questions without manual loading.

### Tasks

- [x] T022 [US2] Add SessionStart hook to lore-merge-settings.js: silently pull context repo in scripts/lore-merge-settings.js
- [x] T023 [US2] Add PostToolUse hook (Write|Edit|MultiEdit matcher) to lore-merge-settings.js: mark claimed task in-progress in scripts/lore-merge-settings.js
- [x] T024 [US2] Add Stop hook to lore-merge-settings.js: remind about open claimed tasks with exact MCP tool command in scripts/lore-merge-settings.js

---

## Phase 5: US3 — Starting a New Feature [P2]

### Story Goal
Developer invokes `/lore-feature` and Claude Code guides the entire
loop: spec → plan → tasks → task wiring. Developer confirms at
decision points, speaks fewer than 10 words.

### Independent Test Criteria
- `lore-gen-constitution --team payments` produces valid constitution.
- `/lore-feature` completes the full loop in under 30 minutes.
- Generated constitution reflects real team ADRs.

### Tasks

- [x] T025 [US3] Write lore-gen-constitution.py: calls MCP get_context + get_adrs, renders .specify/constitution.md. Handles MCP down, missing team, existing file (~60 lines) in scripts/lore-gen-constitution.py
- [x] T026 [US3] ~~Write lore-tasks-to-beads.py~~ — superseded by ADR-009; pipeline task sync handled by `sync_tasks` MCP tool backed by PostgreSQL pipeline.tasks table
- [x] T027 [US3] Write /lore-feature platform skill: asks one question, runs constitution → specify → tasks → sync_tasks wiring silently, confirms at 3 decision points in .claude/skills/lore-feature.md
- [x] T028 [US3] Update install.sh to symlink lore-gen-constitution onto PATH in scripts/install.sh

---

## Phase 6: US4 — Opening a Pull Request [P2]

### Story Goal
Developer invokes `/lore-pr` and Claude Code drafts a complete PR
description from task state, spec, changed files, and ADR references.

### Independent Test Criteria
- `/lore-pr` reads task + spec + diff + ADRs automatically.
- Generated description has all sections populated.
- If no spec exists, asks one question about alternatives rejected.

### Tasks

- [x] T029 [US4] Write /lore-pr platform skill: reads pipeline task + spec + constitution + git diff + ADRs, drafts PR description, asks for one round of edits in .claude/skills/lore-pr.md
- [x] T030 [US4] Update install.sh to copy platform skills from .claude/skills/ to ~/.claude/skills/ in scripts/install.sh

---

## Phase 7: US5 — Context Quality Enforcement [P2]

### Story Goal
CI fails PRs that have empty required sections or contradict active
ADRs. Warning mode for first 2 weeks, manual flip to enforcement.

### Independent Test Criteria
- PR check runs on every PR and warns on empty sections.
- After flag flip, CI hard-fails on empty Why or Alternatives Rejected.
- Enforcement flag is a config value in the workflow file.

### Tasks

- [x] T031 [US5] Write pr-description-check.yml GitHub Action: checks for empty Why and Alternatives Rejected sections, configurable ENFORCE_MODE flag (default: false for warning mode) in .github/workflows/pr-description-check.yml
- [x] T032 [US5] Deploy PR template to all product repos — handled by repo onboarding flow

---

## Phase 8: Integration + Pilot [Phase 0 Gate]

### Goal
Platform engineering team runs the full loop end-to-end on a fresh
machine. Fix friction. Validate Phase 0 before proceeding.

- [x] T033 Run end-to-end pilot: fresh install via curl|bash, lore-gen-constitution, /speckit.specify, /speckit.tasks, sync_tasks, ready_tasks, implement one task, /lore-pr
- [x] T034 Fix friction discovered during pilot run — document any workarounds
- [x] T035 Verify Phase 0 gate: full loop in < 30 minutes, lore-doctor all green, no manual context loading required

---

## Phase 9: US6 — Semantic Context Search [P3]

### Story Goal
Developer asks Claude Code a question and gets semantically relevant
results from PostgreSQL via hybrid vector + keyword search in < 200ms.

### Independent Test Criteria
- `search_context("ChargeBuilder idempotency")` returns code + PR.
- Search results return in < 200ms p99.
- Merged PR reasoning is searchable within 5 minutes.

### Tasks

- [x] T036 [US6] Deploy CNPG Cluster resource (PostgreSQL 16 + pgvector) in namespace "alloydb" on existing GKE cluster (europe-west1)
- [x] T037 [US6] Create schema-per-team DDL: chunks table with VECTOR(768), HNSW index, GIN index on search_tsv for payments, platform, mobile, data, org_shared schemas
- [x] T038 [US6] Configure namespaces (mcp-servers, lore-agent, alloydb) on existing GKE cluster in europe-west1
- [x] T039 [US6] Configure Workload Identity bindings: per-team MCP service account (read own schema + org_shared), lore-agent SA (write ingestion + read GitHub)
- [x] T040 [US6] Upgrade MCP server search_context to hybrid PostgreSQL search: HNSW vector + BM25 keyword with Reciprocal Rank Fusion (k=60) in mcp-server/src/index.ts
- [x] T041 [US6] Upgrade MCP server get_context and get_adrs to query PostgreSQL instead of local files in mcp-server/src/index.ts
- [x] T042 [US6] Add get_file_pr_history tool to MCP server: queries chunks WHERE content_type=pull_request AND file_path in metadata.files_changed in mcp-server/src/index.ts
- [x] T043 [US6] Implement degraded-mode fallback: catch PostgreSQL connection errors, fall back to local files, display one-time warning in mcp-server/src/index.ts
- [x] T044 [P] [US6] Write incremental ingest GitHub Action: on push to main, submit changed files for ingestion in .github/workflows/ingest-context.yml
- [x] T045 [US6] Deploy scheduled jobs in lore-agent: nightly reindex (2am), weekly gap detection (Mon 9am), weekly spec drift (Mon 10am) — replaced 5 standalone CronJobs with single lore-agent scheduler (ADR-007)
- [x] T046 [P] [US6] Write PromptFoo eval suite with 5-10 test cases for payments team in evals/payments/promptfooconfig.yaml
- [x] T047 [P] [US6] Write PromptFoo eval suite with 5-10 test cases for platform team in evals/platform/promptfooconfig.yaml
- [x] T048 [US6] Write context-evals.yml GitHub Action: triggered on ADR/CLAUDE.md/spec changes, runs PromptFoo with --assert-pass-rate 0.85 in .github/workflows/context-evals.yml

---

## Phase 10: US7 — Cluster Delegation [P3]

### Story Goal
Developer delegates well-defined background work to the Lore Agent
via the Lore MCP server. Task runs independently on GKE while
developer continues locally.

> **Architecture change (ADR-007, ADR-011):** Original plan used Klaus HTTP delegation.
> Klaus was replaced by lore-agent (direct Anthropic SDK). Implementation and review
> tasks use ephemeral Job pods via the LoreTask CRD, not in-process execution.

### Independent Test Criteria
- `create_pipeline_task` returns immediately with tracking ID and creates a GitHub Issue.
- `get_pipeline_status` returns current state (queued/running/completed/failed/needs-human-help).
- Failed task: reason stored, no auto-retry (one retry with fix prompt, then needs-human-help).
- `list_pipeline_tasks` shows all tasks for the repo.

### Tasks

- [x] T049 [US7] Build and deploy lore-agent TypeScript service on GKE (lore-agent namespace): calls Anthropic API directly, replaces Klaus. See ADR-007 in adrs/ADR-007-lore-agent-replaces-klaus.md
- [x] T050 [US7] Implement consolidated lore-agent scheduler: nightly reindex, weekly gap detection, weekly spec drift, merge-check, memory lifecycle — replaces 5 standalone K8s CronJobs
- [x] T051 [US7] Implement create_pipeline_task MCP tool: creates DB task record + GitHub Issue (lore-managed label), routes to lore-agent via HTTP in mcp-server/src/index.ts
- [x] T052 [US7] Implement get_pipeline_status MCP tool: reads task state from pipeline.tasks, surfaces failure reason in mcp-server/src/index.ts
- [x] T053 [US7] Implement get_task_logs MCP tool: reads task logs from GCS (no UI needed) in mcp-server/src/index.ts
- [x] T054 [US7] Implement list_pipeline_tasks MCP tool: lists running/completed tasks for agent in mcp-server/src/index.ts
- [x] T055 [US7] Update AGENTS.md with delegation guidance: when to delegate, when not to, always pass context in re-cinq/lore/AGENTS.md

### LoreTask CRD (ADR-011) — Ephemeral Job Execution

- [x] T055a Introduce LoreTask CRD (`lore.re-cinq.com/v1alpha1`): manifests, RBAC, controller Deployment in terraform/modules/gke-mcp/loretask-crd/
- [x] T055b Implement loretask-controller.ts: watches LoreTask CRs, creates ephemeral Job pods with claude-runner image, updates CR status on completion in agent/src/loretask-controller.ts
- [x] T055c Build claude-runner Docker image: minimal container (node + git + claude CLI), entrypoint clones repo, runs Claude Code, runs deterministic validation, commits, pushes in docker/claude-runner/
- [x] T055d Add .github/workflows/build-claude-runner.yml CI for claude-runner image
- [x] T055e Implement loretask-watcher.ts: scheduled job that polls completed LoreTasks, creates PRs from pushed branches in agent/src/jobs/loretask-watcher.ts

---

## Phase 11: Observability [Phase 1]

### Goal
All MCP retrieval calls traced via OpenTelemetry to Cloud Monitoring.
Low-confidence retrievals tagged for gap detection. No Langfuse, no
Cloud SQL, no BigQuery — OTEL built directly into the MCP server.

- [x] T056 Integrate OpenTelemetry SDK into Lore MCP server with Cloud Monitoring exporter for traces + metrics in mcp-server/src/otel.ts
- [x] T057 Configure OTEL spans for all MCP retrieval calls with latency and confidence attributes
- [x] T058 [P] Set up Cloud Monitoring custom metric (lore/gap_candidates) for low-confidence retrieval tracking
- [x] T059 Implement tracedSearch wrapper in MCP server: emits OTEL spans for every retrieval call, tags low-confidence (< 0.72) as gap_candidate via span attributes
- [x] T060 Configure Cloud Monitoring dashboards: retrieval latency p99, gap candidate rate, query volume per namespace

---

## Phase 12: Pipeline Hardening (ADR-013)

### Goal
Deterministic validation gates, pre-run context hydration, subdirectory
convention rules, Slack integration, and two-round retry cap.
Inspired by Stripe Minions architecture.

- [x] T060a Implement repo-validation.ts: detect repo tooling (package.json, go.mod, pyproject.toml, Cargo.toml), run lint/typecheck scoped to changed files in mcp-server/src/repo-validation.ts
- [x] T060b Implement two-round retry cap: on validation failure, spawn fix-only Claude Code pass; after second failure mark task needs-human-help and preserve worktree
- [x] T060c Implement pre-run context hydration: fetch assembled context from Lore API before spawning Claude Code in both local-runner and entrypoint.sh
- [x] T060d Add subdirectory convention rules: load .claude/rules/*.md files conditionally during context assembly, matched by keyword against task query. Added to all four templates at priority 1
- [x] T060e Implement Slack integration: /lore slash command creates pipeline tasks. Watcher posts PR links, issue links, failure messages to originating channel. scripts/slack-app-manifest.yaml

---

## Phase 13: US8 — Automated Gap Detection [P4]

### Story Goal
Weekly job identifies low-confidence retrieval clusters and a Lore
Agent drafts missing content and opens PRs to re-cinq/lore. Human
review required.

### Independent Test Criteria
- Gap detection identifies clusters with 3+ occurrences.
- Lore Agent drafts specific, actionable content.
- PR opened to re-cinq/lore, labelled context-gap-draft, assigned to team.
- No content merged without human review.

### Tasks

- [x] T061 [US8] ~~Deploy self-hosted Dolt remote~~ — superseded by ADR-009; pipeline tasks use PostgreSQL pipeline.tasks table, no Dolt required
- [x] T062 [US8] Add .specify/** to context-evals.yml trigger paths (1 line) in .github/workflows/context-evals.yml
- [x] T063 [US8] Deploy weekly gap detection job in lore-agent scheduler (Monday 9am UTC): runs gap-detect.ts which queries Cloud Monitoring for gap candidate metrics
- [x] T064 [US8] Write Lore Agent prompt for gap detection: query Cloud Monitoring for gap candidate metrics, cluster by similarity, draft missing content, open PR to re-cinq/lore with context-gap-draft label in scripts/klaus-prompts/gap-detection.md

---

## Phase 14: Intelligent Memory Lifecycle (ADR-014)

### Goal
Passive session capture, post-task auto-curation, importance decay,
fact consolidation, session diversification, and privacy filtering.
No agent cooperation required.

- [x] T064a Implement session-tracker.ts: passive MCP tool call tracking (500-entry ring buffer), dump to ~/.lore/last-session.json on exit in mcp-server/src/session-tracker.ts
- [x] T064b Add Stop hook to lore-merge-settings.js: POST ~/.lore/last-session.json to /api/session-summary for automatic episode + fact extraction
- [x] T064c Implement episode-writer.ts: shared utility for post-task auto-curation. After every task completion write episode; high-signal events trigger Haiku lesson extraction stored as auto-curation/{ref} memories in agent/src/lib/episode-writer.ts
- [x] T064d Implement memory-lifecycle.ts: daily importance decay job (5AM) scores memories 0-10 using half-life model, evicts lowest-scoring when agent exceeds 500 memories. Daily consolidation job (5:30AM) groups recent facts by repo, extracts higher-level patterns via Haiku in agent/src/jobs/memory-lifecycle.ts
- [x] T064e Implement session diversification in RRF merge: cap results to max 3 per (agent_id + source) combo to prevent one verbose session dominating search
- [x] T064f Implement privacy filtering: sanitizeContent() / redactSecrets() strips API keys, JWTs, private keys, connection strings, bearer tokens before all memory writes

---

## Phase 15: Autonomous Review Loop (ADR-012)

### Goal
After an implementation PR is created, automatically review it with
a dedicated LoreTask and iterate (max 2 rounds) before human merge.

- [x] T064g Implement review-reactor.ts: after implementation PR created, auto-create review LoreTask CR if auto_review setting is enabled in agent/src/jobs/review-reactor.ts
- [x] T064h Review Job pod: clone PR branch, read spec + conventions, post PR comments via gh CLI, output APPROVED or CHANGES_REQUESTED
- [x] T064i Iteration logic: on CHANGES_REQUESTED (iteration < 2) create new implementation LoreTask on same branch with feedback as context; on iteration >= 2 escalate to human

---

## Phase 16: US9 — Knowledge Graph + Context Cores + Self-Improvement [P5]

### Story Goal
Temporal knowledge graph via Graphiti enables multi-hop reasoning.
Context Cores provide versioned, evaluated context distribution.
Autoresearch loop autonomously improves context quality.

### Independent Test Criteria
- `graph_search` traverses Graphiti: Function → PR → ADR chain.
- `get_entity_history` returns temporal history with validity windows.
- Context Core nightly build promotes when eval score improves.
- Autoresearch loop generates candidates, evaluates, and opens PR.
- Spec drift detection adds VIOLATES edges to Graphiti.

### Tasks

- [x] T065 [US9] Write ontology definition file with 8 entity types and 15 relationships in scripts/graphiti/ontology.yaml
- [x] T066 [US9] ~~Write K8s manifests for Graphiti deployment on GKE (graphiti namespace + FalkorDB)~~ — **PERMANENTLY DEFERRED** — superseded by ADR-010; PostgreSQL live knowledge graph (`memory.entities` + `memory.edges`) replaces Graphiti. `scripts/graphiti/ontology.yaml` kept for reference only.
- [x] T067 [US9] ~~Rewrite mcp-server/src/graph.ts as Graphiti MCP proxy~~ — **PERMANENTLY DEFERRED** — `mcp-server/src/graph.ts` queries the PostgreSQL knowledge graph directly. `query_graph` MCP tool is live; temporal traversal (`get_entity_history`) not implemented (flat SQL only, not traversal-based).
- [x] T068 [US9] Write Lore Agent prompt for weekly spec drift detection with VIOLATES graph edges in scripts/klaus-prompts/spec-drift.md
- [x] T069 [US9] Add optional AgentDB local cache prompt to install.sh
- [x] T070b [US9] Write Context Core manifest schema (lore-core.json) in scripts/context-cores/manifest-schema.json
- [x] T071b [US9] Write Lore Agent prompt for nightly Context Core builder (build → eval → promote/discard) in scripts/klaus-prompts/context-core-builder.md
- [x] T072b [US9] Write research-charter.md with standing instructions for the autoresearch loop in research-charter.md
- [x] T073b [US9] Write Lore Agent prompt for weekly autoresearch loop (generate → eval → promote/discard) in scripts/klaus-prompts/autoresearch-loop.md

---

## Phase 17: Cost Optimisations + Event-Driven Review (ADR-015)

### Goal
Replace the 5-min review-reactor poll with a GitHub webhook fan-out, add prompt
caching to all agent LLM calls, and reduce default context budgets. Fix the latent
`LORE_WEBHOOK_SECRET` mounting bug that silently blocked all webhook signature
validation. See ADR-015 for full context.

- [x] T074 Fix `LORE_WEBHOOK_SECRET` ExternalSecret — was never mounted in the pod; `handleGitHubWebhook` always returned 503. Mount secret into the MCP server pod env and add it to `routes.ts` middleware. (`mcp-server/src/routes.ts`, `terraform/modules/gke-mcp/`)
- [x] T075 Extend GitHub App webhook subscriptions to include `pull_request_review` and `issue_comment` events in addition to existing `pull_request` and `issues`
- [x] T076 Update `mcp-server/src/routes.ts` webhook handler: handle `pull_request_review.submitted` and `issue_comment.created` (on PRs). For qualifying events POST `{repo, pr_number}` to `LORE_AGENT_URL/api/trigger/review-reactor` with `LORE_AGENT_INTERNAL_TOKEN` bearer. Log warning if `LORE_AGENT_URL` is not configured (silently disables webhook path).
- [x] T077 Add `POST /api/trigger/review-reactor` endpoint to Lore Agent (`agent/src/health.ts`): validates `LORE_AGENT_INTERNAL_TOKEN`, returns 202, runs `runReviewReactorForPR` in background. Never gated by business hours.
- [x] T078 Replace 5-min `reviewReactorJob` cron with business-hours safety cron (`7 7-17 * * 1-5`): implement `isBusinessHours()` in `agent/src/lib/business-hours.ts` reading `LORE_BUSINESS_HOURS_{TZ,START,END}` and `LORE_BUSINESS_DAYS` (defaults: Europe/Berlin, 9, 18, Mon-Fri). Off-hours ticks no-op.
- [x] T079 Implement prompt caching in `agent/src/lib/prompt-cache.ts`: `getCacheControl(jobName)` returns `{type:"ephemeral",ttl:"1h"}` for jobs in `LORE_CACHE_1H_JOBS` allowlist (default: auto-curation, review_reactor, fact-extraction, graph-extraction), `{type:"ephemeral"}` (5m) otherwise. `computeCachePrefixHash` (djb2). `analyzeCacheBreak` per-job in-memory tracker.
- [x] T080 Wire prompt caching into `callLLM` and `callLLMWithTool` in `agent/src/anthropic.ts`: two cache breakpoints per request (system block + tool schema), `response.usage.cache_*` feeds cost accounting (1.25× writes, 0.1× reads). Hash system+tools prefix per `jobName`; emit `cache hit | first-call | break:system | break:tools | break:ttl(Xm)` on log line.
- [x] T081 Reduce `assembleContext` default token budget from 16K to 8K. Research template keeps 16K. Implementation/review/default capped at 8K. Update `assemble_context` MCP tool `max_tokens` parameter default to 8K.
- [x] T082 Add two new required env vars to Helm values and Terraform: `LORE_AGENT_URL` (mcp-server needs to fan out to agent) and `LORE_AGENT_INTERNAL_TOKEN` (shared secret for mcp-server → agent calls). Document in `secrets.tfvars.example`.

---

## Phase 18: Polish & Cross-Cutting Concerns

- [x] T070 Review and harden install.sh error handling: ensure every step has clear error messages and recovery instructions in scripts/install.sh
- [x] T071 Write internal comms template for PR description enforcement rollout (frame as "makes Claude Code smarter for the team")
- [x] T072 Verify K8s manifests — lore-agent and MCP server deployed and running; LoreTask CRD live
- [x] T073 Update lore-doctor.sh to include Phase 1+ checks: PostgreSQL (CNPG) reachable, lore-agent endpoint responsive, OTEL traces flowing to Cloud Monitoring in scripts/lore-doctor.sh

---

## Dependencies

```
Phase 1 (Setup)
  └── Phase 2 (Content) ── T005-T015
        ├── Phase 3 (US1: First-Time Setup) ── T016-T021
        │     └── Phase 4 (US2: Orientation) ── T022-T024
        │           ├── Phase 5 (US3: Feature Loop) ── T025-T028
        │           └── Phase 6 (US4: PR Drafting) ── T029-T030
        ├── Phase 7 (US5: PR Quality CI) ── T031-T032
        └── Phase 8 (Pilot + Gate) ── T033-T035
              └── Phase 9 (US6: Semantic Search) ── T036-T048
                    ├── Phase 10 (US7: Cluster Delegation via LoreTask CRD) ── T049-T055e
                    └── Phase 11 (Observability) ── T056-T060
                          ├── Phase 12 (Pipeline Hardening) ── T060a-T060e
                          ├── Phase 13 (US8: Gap Detection) ── T061-T064
                          ├── Phase 14 (Memory Lifecycle) ── T064a-T064f
                          ├── Phase 15 (Autonomous Review Loop) ── T064g-T064i
                          ├── Phase 16 (US9: Knowledge Graph + Context Cores) ── T065-T073b
                          │     Depends on: Phase 11 + Phase 13
                          └── Phase 17 (ADR-015: Webhook reactor + caching) ── T074-T082
                                Depends on: Phase 15
```

## Parallel Execution Opportunities

### Phase 0 (Days 1-3)

```
Day 1:
  Agent A: T005 (root CLAUDE.md)
  Agent B: T006, T007, T008, T009 (team CLAUDE.md files) [P]
  Agent C: T010, T011, T012 (ADRs) [P]
  Agent D: T013, T014 (runbooks) [P]
  Agent E: T004 (PR template) [P]
  Sync: T015 (CODEOWNERS — needs team structure decided)

Day 2:
  Agent A: T016 (MCP server)
  Agent B: T017 (Dockerfile) + T018 (merge-settings) [P]
  Agent C: T019 (lore-doctor) [P]
  Sync: T020 (install.sh — depends on T016, T018, T019)
  Agent D: T021 (AGENTS.md) [P]

Day 3:
  Agent A: T025 (lore-gen-constitution) [P]
  Agent B: T027 (lore-feature skill) [P]
  Agent C: T029 (lore-pr skill) [P]
  Sync: T022-T024 (hooks — updates merge-settings)
  Sync: T028, T030 (install.sh updates)
  Agent D: T031 (PR check CI) [P]
```

### Phase 1 (Weeks 2-3)

```
Week 2:
  Agent A: T036, T037 (CNPG Cluster + schemas) [P]
  Agent B: T038, T039 (GKE namespace setup + Workload Identity) [P]
  Agent C: T049, T050 (lore-agent build + deploy)
  Sync: T040-T043 (MCP server upgrade — needs PostgreSQL)

Week 3:
  Agent A: T044, T045 (ingestion triggers + scheduler jobs) [P]
  Agent B: T046, T047 (PromptFoo evals) [P]
  Agent C: T051-T055e (pipeline tools + LoreTask CRD)
  Agent D: T056-T059 (OTEL instrumentation) [P]
  Sync: T048 (context-evals CI)
```

## Implementation Strategy

### MVP (Phase 0 — Days 1-4)
- T001-T035: Full developer experience with zero infrastructure.
- 35 tasks, targeting 3-4 working days.
- Gate: pilot team completes full feature loop.

### Phase 1 Increment (Weeks 2-3)
- T036-T060e: PostgreSQL (CNPG), Lore Agent, OTEL + Cloud Monitoring, PromptFoo CI, pipeline hardening.
- ~30 tasks, targeting 2 weeks.
- Gate: Phase 1 acceptance criteria pass.

### Phase 2 Increment (Weeks 4-5)
- T061-T064i: Gap detection, memory lifecycle, autonomous review loop.
- ~12 tasks, targeting 1.5 weeks.

### Phase 3 Increment (Weeks 6-10)
- T065-T073b: Graphiti + FalkorDB (T066-T067 still pending), Context Cores, autoresearch loop, spec drift.
- 9 tasks, targeting 5 weeks.
- **Blocked:** T066 and T067 require Graphiti K8s deployment (not yet started).

## Open Work

| Task | Description | Blocker |
|------|-------------|---------|
| — | Knowledge graph temporal traversal (`get_entity_history`) | Not scheduled — flat SQL covers current needs; Graphiti permanently deferred |
| — | p99 latency benchmark for hybrid search | No active owner; 200ms target aspirational until measured under load |
| — | Context Core OCI promotion | `context-core-builder.ts` exists; OCI artifact push + `crane pull` in install.sh not wired |

## Summary

| Metric                       | Value |
|------------------------------|-------|
| Total tasks                  | 100+  |
| Phase 0 (MVP) tasks         | 35    |
| Phase 1 tasks               | ~30   |
| Phase 2 tasks               | ~12   |
| Phase 3 tasks               | 9     |
| Phase 4 (ADR-015) tasks     | 9     |
| Polish tasks                | 4     |
| Parallelizable tasks ([P])  | 26+   |
| User stories covered        | 9/9   |
| Permanently deferred        | T066, T067 (Graphiti/FalkorDB — superseded by ADR-010) |
| Open items                  | 3 non-blocking (temporal traversal, p99 benchmark, OCI promotion) |
