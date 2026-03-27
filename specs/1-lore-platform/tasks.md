# Tasks: Lore Platform

| Field   | Value                                |
|---------|--------------------------------------|
| Feature | Lore — Shared Context Infrastructure |
| Branch  | 1-lore-platform                      |
| Plan    | [plan.md](plan.md)                   |
| Spec    | [spec.md](spec.md)                   |
| Created | 2026-03-25                           |

## User Story Map

| Story | Spec Scenario                | Priority | Delivery Phase |
|-------|------------------------------|----------|----------------|
| US1   | First-Time Setup             | P1       | Phase 0 Day 1-2 |
| US2   | Morning Orientation          | P1       | Phase 0 Day 2-3 |
| US3   | Starting a New Feature       | P2       | Phase 0 Day 3   |
| US4   | Opening a Pull Request       | P2       | Phase 0 Day 3   |
| US5   | Context Quality Enforcement  | P2       | Phase 0 Day 1 + Phase 1 |
| US6   | Semantic Context Search      | P3       | Phase 1         |
| US7   | Cluster Delegation           | P3       | Phase 1         |
| US8   | Automated Gap Detection      | P4       | Phase 2         |
| US9   | Knowledge Graph Traversal    | P5       | Phase 3         |

---

## Phase 1: Setup

- [x] T001 Initialize `acme/context` GitHub repository with README, .gitignore, and LICENSE
- [x] T002 Create repository directory structure per plan.md in acme/context/
- [x] T003 [P] Initialize MCP server project with package.json and tsconfig.json in mcp-server/
- [x] T004 [P] Create .github/PULL_REQUEST_TEMPLATE.md with required sections (Why, Approach, Alternatives Rejected, ADR References, Spec)

---

## Phase 2: Foundational — Context Content

These tasks create the context content that all user stories depend on.

### Goal
Populate the context repository with real organizational knowledge
so the MCP server has content to serve and all downstream tools
have context to work with.

- [x] T005 Write root CLAUDE.md with architecture contracts, code conventions, and key service descriptions (under 2 pages) in acme/context/CLAUDE.md
- [x] T006 [P] Write payments team conventions including ADR-042 minor units, PCI scope, and idempotency patterns in acme/context/teams/payments/CLAUDE.md
- [x] T007 [P] Write platform team conventions in acme/context/teams/platform/CLAUDE.md
- [x] T008 [P] Write mobile team conventions in acme/context/teams/mobile/CLAUDE.md
- [x] T009 [P] Write data team conventions in acme/context/teams/data/CLAUDE.md
- [x] T010 [P] Write ADR-042 (monetary amounts in minor units) in MADR format with YAML frontmatter in acme/context/adrs/ADR-042-minor-units.md
- [x] T011 [P] Write second real ADR in MADR format with YAML frontmatter in acme/context/adrs/
- [x] T012 [P] Write third real ADR in MADR format with YAML frontmatter in acme/context/adrs/
- [x] T013 [P] Write runbook for stripe webhook failure incident in acme/context/runbooks/payments-service-stripe-webhook-failure.md
- [x] T014 [P] Write second runbook from real incident in acme/context/runbooks/
- [x] T015 Create CODEOWNERS with ownership boundaries (root CLAUDE.md -> platform-eng + tech-leads, teams/ -> respective teams, adrs/ -> arch-group) in acme/context/CODEOWNERS

---

## Phase 3: US1 — First-Time Setup [P1]

### Story Goal
A new developer runs one install command and has a fully configured
Claude Code environment with org context loaded in under 5 minutes.

### Independent Test Criteria
- `install.sh` completes on clean macOS/Linux machine in < 5 minutes.
- `acme-doctor` reports all green.
- Re-running `install.sh` is idempotent — no errors, no side effects.
- Claude Code opens with MCP server configured and context available.

### Tasks

- [x] T016 [US1] Implement MVP MCP server with get_context, get_adrs, and search_context tools (~80 lines) in mcp-server/src/index.ts
- [x] T017 [US1] Add Dockerfile for MCP server in mcp-server/Dockerfile
- [x] T018 [US1] Write acme-merge-settings.js that reads existing ~/.claude/settings.json and merges platform MCP config, env vars, and hooks without overwriting personal hooks (~40 lines) in scripts/acme-merge-settings.js
- [x] T019 [US1] Write acme-doctor.sh health check that tests MCP server, get_context, bd CLI, specify CLI, git connectivity, hooks, and skills — prints pass/fail with fix instructions (~40 lines) in scripts/acme-doctor.sh
- [x] T020 [US1] Write install.sh: clone repo, build MCP server, detect team, run acme-merge-settings.js, install skills, install bd + specify-cli, run bd init, run acme-doctor — idempotent, works without pre-clone in scripts/install.sh
- [x] T021 [US1] Write AGENTS.md with proactive guidance instructions (first session greeting, orientation, feature start, delegation, task tracking) in acme/context/AGENTS.md

---

## Phase 4: US2 — Morning Orientation [P1]

### Story Goal
Developer opens Claude Code and context + task state sync
automatically. Unblocked tasks surface without manual action.

### Independent Test Criteria
- SessionStart hook pulls context repo and Beads state silently.
- PostToolUse hook marks claimed task in-progress on file edit.
- Stop hook reminds about open claimed tasks.
- `bd ready` shows tasks after Beads wiring.
- Claude Code answers convention questions without manual loading.

### Tasks

- [x] T022 [US2] Add SessionStart hook to acme-merge-settings.js: silently pull context repo + bd pull in scripts/acme-merge-settings.js
- [x] T023 [US2] Add PostToolUse hook (Write|Edit|MultiEdit matcher) to acme-merge-settings.js: mark claimed task in-progress in scripts/acme-merge-settings.js
- [x] T024 [US2] Add Stop hook to acme-merge-settings.js: remind about open claimed tasks with exact bd command in scripts/acme-merge-settings.js

---

## Phase 5: US3 — Starting a New Feature [P2]

### Story Goal
Developer invokes `/acme-feature` and Claude Code guides the entire
loop: constitution -> spec -> tasks -> Beads wiring. Developer
confirms at 3 decision points, speaks fewer than 10 words.

### Independent Test Criteria
- `acme-gen-constitution --team payments` produces valid constitution.
- `acme-tasks-to-beads tasks.md` creates Beads tasks with deps.
- `/acme-feature` completes the full loop in under 30 minutes.
- Generated constitution reflects real team ADRs.

### Tasks

- [x] T025 [US3] Write acme-gen-constitution.py: calls MCP get_context + get_adrs, renders .specify/constitution.md. Handles MCP down, missing team, existing file (~60 lines) in scripts/acme-gen-constitution.py
- [x] T026 [US3] Write acme-tasks-to-beads.py: parses Spec Kit tasks.md, calls bd create per task, bd dep add for [DEPENDS ON] markers. Handles bd not installed, file missing, duplicates (~80 lines) in scripts/acme-tasks-to-beads.py
- [x] T027 [US3] Write /acme-feature platform skill: asks one question, runs constitution -> specify -> tasks -> Beads wiring silently, confirms at 3 decision points in .claude/skills/acme-feature.md
- [x] T028 [US3] Update install.sh to symlink acme-gen-constitution and acme-tasks-to-beads onto PATH in scripts/install.sh

---

## Phase 6: US4 — Opening a Pull Request [P2]

### Story Goal
Developer invokes `/acme-pr` and Claude Code drafts a complete PR
description from Beads task, spec, changed files, and ADR references.

### Independent Test Criteria
- `/acme-pr` reads task + spec + diff + ADRs automatically.
- Generated description has all sections populated.
- If no spec exists, asks one question about alternatives rejected.

### Tasks

- [x] T029 [US4] Write /acme-pr platform skill: reads Beads task + spec + constitution + git diff + ADRs, drafts PR description, asks for one round of edits in .claude/skills/acme-pr.md
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
- [ ] T032 [US5] Deploy PR template to all product repos (payments-service, platform-api, mobile-bff, data-pipeline) via script or manual in .github/PULL_REQUEST_TEMPLATE.md

---

## Phase 8: Integration + Pilot [Phase 0 Gate]

### Goal
Platform engineering team runs the full loop end-to-end on a fresh
machine. Fix friction. Validate Phase 0 before proceeding.

- [ ] T033 Run end-to-end pilot: fresh install via curl|bash, acme-gen-constitution, /speckit.specify, /speckit.tasks, acme-tasks-to-beads, bd ready, implement one task, /acme-pr
- [ ] T034 Fix friction discovered during pilot run — document any workarounds
- [ ] T035 Verify Phase 0 gate: full loop in < 30 minutes, acme-doctor all green, no manual context loading required

---

## Phase 9: US6 — Semantic Context Search [P3]

### Story Goal
Developer asks Claude Code a question and gets semantically relevant
results from AlloyDB via hybrid vector + keyword search in < 200ms.

### Independent Test Criteria
- `search_context("ChargeBuilder idempotency")` returns code + PR.
- Search results return in < 200ms p99.
- Merged PR reasoning is searchable within 5 minutes.

### Tasks

- [x] T036 [US6] Write Terraform module for AlloyDB cluster (Enterprise, europe-west4, db-perf-optimized-N-4) with vector/scann/ml extensions in terraform/modules/alloydb/
- [x] T037 [US6] Write Terraform AlloyDB schema-per-team DDL: chunks table with VECTOR(768), ScaNN index, GIN index on search_tsv for payments, platform, mobile, data, org_shared in terraform/modules/alloydb/schemas.sql
- [x] T038 [US6] Write Terraform module for GKE cluster (acme-ai-platform, private, regional europe-west4) with mcp-servers, langfuse, klaus namespaces in terraform/modules/gke-mcp/
- [x] T039 [US6] Write Terraform Workload Identity bindings: per-team MCP service account (read own schema + org_shared), Klaus SA (write ingestion + read GitHub) in terraform/modules/gke-mcp/workload-identity.tf
- [x] T040 [US6] Upgrade MCP server search_context to hybrid AlloyDB search: ScaNN vector + BM25 keyword with Reciprocal Rank Fusion (k=60) in mcp-server/src/index.ts
- [x] T041 [US6] Upgrade MCP server get_context and get_adrs to query AlloyDB instead of local files in mcp-server/src/index.ts
- [x] T042 [US6] Add get_file_pr_history tool to MCP server: queries chunks WHERE content_type=pull_request AND file_path in metadata.files_changed in mcp-server/src/index.ts
- [x] T043 [US6] Implement degraded-mode fallback: catch AlloyDB connection errors, fall back to local files, display one-time warning in mcp-server/src/index.ts
- [x] T044 [P] [US6] Write incremental ingest GitHub Action: on push to main, submit changed files to Klaus via delegate_task in .github/workflows/ingest-context.yml
- [x] T045 [US6] Configure Cloud Scheduler nightly job (2am): full re-index via delegate_task to Klaus, hard-delete stale chunks in terraform/modules/gke-mcp/cloud-scheduler.tf
- [x] T046 [P] [US6] Write PromptFoo eval suite with 5-10 test cases for payments team in evals/payments/promptfooconfig.yaml
- [x] T047 [P] [US6] Write PromptFoo eval suite with 5-10 test cases for platform team in evals/platform/promptfooconfig.yaml
- [x] T048 [US6] Write context-evals.yml GitHub Action: triggered on ADR/CLAUDE.md/spec changes, runs PromptFoo with --assert-pass-rate 0.85 in .github/workflows/context-evals.yml

---

## Phase 10: US7 — Cluster Delegation [P3]

### Story Goal
Developer delegates well-defined background work to Klaus via the
Lore MCP server. Task runs independently on GKE while developer
continues locally.

### Independent Test Criteria
- `delegate_task` returns immediately with tracking ID.
- `task_status` returns current state (running/completed/failed).
- Failed task: reason stored, Beads claim released, no auto-retry.
- `list_cluster_tasks` shows all running tasks.

### Tasks

- [x] T049 [US7] Write Klaus Helm chart for GKE klaus namespace with HTTP MCP endpoint, resource limits, configurable timeouts in terraform/modules/gke-mcp/klaus-helm/
- [x] T050 [US7] Implement buildContextBundle function: packages Beads task + spec + constitution + AlloyDB seed chunks + branch (~80 lines) in mcp-server/src/context-bundle.ts
- [x] T051 [US7] Implement delegate_task MCP tool: packages context bundle, submits to Klaus HTTP endpoint, returns task_id in mcp-server/src/index.ts
- [x] T052 [US7] Implement task_status MCP tool: polls Klaus for task state, surfaces failure reason and Beads claim release in mcp-server/src/index.ts
- [x] T053 [US7] Implement task_result MCP tool: retrieves completed output from Klaus in mcp-server/src/index.ts
- [x] T054 [US7] Implement list_cluster_tasks MCP tool: lists all running/completed tasks in mcp-server/src/index.ts
- [x] T055 [US7] Update AGENTS.md with delegation guidance: when to delegate, when not to, always pass context in acme/context/AGENTS.md

---

## Phase 11: Observability [Phase 1]

### Goal
All MCP retrieval calls traced in Langfuse. Low-confidence retrievals
tagged for gap detection.

- [x] T056 Write Terraform module for Langfuse: Helm chart on GKE langfuse namespace, Cloud SQL Auth Proxy sidecar, OIDC SSO in terraform/modules/langfuse/
- [x] T057 Write Terraform for Cloud SQL (postgres-15, db-g1-small) for Langfuse metadata in terraform/modules/langfuse/cloud-sql.tf
- [x] T058 [P] Write Terraform for BigQuery dataset acme_platform_traces and Cloud Storage bucket acme-langfuse-media in terraform/modules/langfuse/bigquery.tf
- [x] T059 Implement tracedSearch wrapper in MCP server: traces every retrieval call to Langfuse, tags low-confidence (< 0.72) as gap_candidate in mcp-server/src/index.ts
- [x] T060 Configure Langfuse BigQuery export integration for gap detection analytics in terraform/modules/langfuse/

---

## Phase 12: US8 — Automated Gap Detection [P4]

### Story Goal
Weekly job identifies low-confidence retrieval clusters and a Klaus
agent drafts missing content and opens PRs to acme/context. Human
review required.

### Independent Test Criteria
- Gap detection identifies clusters with 3+ occurrences.
- Klaus agent drafts specific, actionable content.
- PR opened to acme/context, labelled context-gap-draft, assigned to team.
- No content merged without human review.

### Tasks

- [x] T061 [US8] Deploy self-hosted Dolt remote on GKE (dolt-helm chart) and update install.sh to add remote + auto-pull in scripts/install.sh
- [x] T062 [US8] Add .specify/** to context-evals.yml trigger paths (1 line) in .github/workflows/context-evals.yml
- [x] T063 [US8] Configure Cloud Scheduler weekly job (Monday 9am UTC): gap detection via delegate_task to Klaus in terraform/modules/gke-mcp/cloud-scheduler.tf
- [x] T064 [US8] Write Klaus agent prompt for gap detection: query BigQuery for gap traces, cluster by similarity, draft missing content, open PR to acme/context with context-gap-draft label

---

## Phase 13: US9 — Knowledge Graph + Context Cores + Self-Improvement [P5]

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
- [ ] T066 [US9] Write Terraform/Helm for Graphiti deployment on GKE (graphiti namespace + FalkorDB) in terraform/modules/graphiti/
- [ ] T067 [US9] Rewrite mcp-server/src/graph.ts: graph_search and get_entity_history as Graphiti MCP proxies (replace local JSON implementation)
- [x] T068 [US9] Write Klaus agent prompt for weekly spec drift detection with VIOLATES graph edges in scripts/klaus-prompts/spec-drift.md
- [x] T069 [US9] Add optional AgentDB local cache prompt to install.sh
- [x] T070b [US9] Write Context Core manifest schema (lore-core.json) in scripts/context-cores/manifest-schema.json
- [x] T071b [US9] Write Klaus agent prompt for nightly Context Core builder (build → eval → promote/discard) in scripts/klaus-prompts/context-core-builder.md
- [x] T072b [US9] Write research-charter.md with standing instructions for the autoresearch loop in research-charter.md
- [x] T073b [US9] Write Klaus agent prompt for weekly autoresearch loop (generate → eval → promote/discard) in scripts/klaus-prompts/autoresearch-loop.md

---

## Phase 14: Polish & Cross-Cutting Concerns

- [x] T070 Review and harden install.sh error handling: ensure every step has clear error messages and recovery instructions in scripts/install.sh
- [x] T071 Write internal comms template for PR description enforcement rollout (frame as "makes Claude Code smarter for the team")
- [ ] T072 Verify all Terraform modules pass `terraform validate` and `terraform plan` in terraform/
- [x] T073 Update acme-doctor.sh to include Phase 1+ checks: AlloyDB reachable, Langfuse reachable, Klaus endpoint responsive in scripts/acme-doctor.sh

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
                    ├── Phase 10 (US7: Cluster Delegation) ── T049-T055
                    └── Phase 11 (Observability) ── T056-T060
                          ├── Phase 12 (US8: Gap Detection) ── T061-T064
                          └── Phase 13 (US9: Knowledge Graph + Context Cores + Self-Improvement) ── T065-T073b
                                Depends on: Phase 11 (Observability) + Phase 12 (Gap Detection)
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
  Agent C: T019 (acme-doctor) [P]
  Sync: T020 (install.sh — depends on T016, T018, T019)
  Agent D: T021 (AGENTS.md) [P]

Day 3:
  Agent A: T025 (acme-gen-constitution) [P]
  Agent B: T026 (acme-tasks-to-beads) [P]
  Agent C: T027 (acme-feature skill) [P]
  Agent D: T029 (acme-pr skill) [P]
  Sync: T022-T024 (hooks — updates merge-settings)
  Sync: T028, T030 (install.sh updates)
  Agent E: T031 (PR check CI) [P]
```

### Phase 1 (Weeks 2-3)

```
Week 2:
  Agent A: T036, T037 (AlloyDB Terraform) [P]
  Agent B: T038, T039 (GKE Terraform) [P]
  Agent C: T049 (Klaus Helm chart)
  Sync: T040-T043 (MCP server upgrade — needs AlloyDB)

Week 3:
  Agent A: T044, T045 (ingestion triggers) [P]
  Agent B: T046, T047 (PromptFoo evals) [P]
  Agent C: T050, T051-T054 (Klaus client + delegation tools)
  Agent D: T056-T058 (Langfuse Terraform) [P]
  Sync: T048 (context-evals CI)
  Sync: T059 (tracedSearch — needs Langfuse)
```

## Implementation Strategy

### MVP (Phase 0 — Days 1-4)
- T001-T035: Full developer experience with zero infrastructure.
- 35 tasks, targeting 3-4 working days.
- Gate: pilot team completes full feature loop.

### Phase 1 Increment (Weeks 2-3)
- T036-T060: AlloyDB, Klaus, Langfuse, PromptFoo CI.
- 25 tasks, targeting 2 weeks.
- Gate: Phase 1 acceptance criteria pass.

### Phase 2 Increment (Weeks 4-5)
- T061-T064: Dolt remote, spec evals, gap detection.
- 4 tasks, targeting 1.5 weeks.

### Phase 3 Increment (Weeks 6-10)
- T065-T073b: Graphiti + FalkorDB, Context Cores, autoresearch loop, spec drift, AgentDB cache.
- 9 tasks, targeting 5 weeks.
- Depends on Phase 11 (Observability) + Phase 12 (Gap Detection).

## Summary

| Metric                       | Value |
|------------------------------|-------|
| Total tasks                  | 77    |
| Phase 0 (MVP) tasks         | 35    |
| Phase 1 tasks               | 25    |
| Phase 2 tasks               | 4     |
| Phase 3 tasks               | 9     |
| Polish tasks                | 4     |
| Parallelizable tasks ([P])  | 26    |
| User stories covered        | 9/9   |
