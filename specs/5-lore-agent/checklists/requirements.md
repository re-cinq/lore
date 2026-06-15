# Specification Assessment: Lore Agent Service

**Purpose**: Document specification evolution, implementation status, and ADR relationships
**Created**: 2026-03-29
**Updated**: 2026-06-15 (implementation assessment)
**Feature**: [spec.md](../spec.md)
**Status**: Shipped (with ADR supersessions noted)

## Specification Evolution

The Lore Agent Service spec defines a purpose-built agent runtime for Lore's
pipeline (requirements 1–5 in Problem Statement). The spec evolved through
three phases:

1. **Core definition (3/29–4/28)**: FRs 1–10 define direct LLM integration,
   repo context fetching, structured output parsing, and CR creation pipelines.
2. **Dark-factory integration (4/28–5/15)**: ADR-016 reshaped FRs 1–7 to add
   workflow graphs, commit trailers for audit, and branch-as-durable-state.
   **FR-6 (Job Scheduling) partially superseded by ADR-019 (2/06-02)**:
   heavy batch jobs moved to K8s CronJobs; only hot-path/sub-minute jobs
   remain in-process (see FR-6 note in spec.md).
3. **Implementation shipping (5/15–6/15)**: All FRs 1–17 implemented; core
   workflow, supervisor, and Job pod runners deployed to GKE. Local runner
   supports worktrees for developer delegation.

## Content Quality Assessment

- [x] No implementation details (languages, frameworks, APIs)
  - **Exception (justified)**: Technical terms-of-art documented in spec Key
    Entities (workflow YAML, supervisor process, commit trailer, CRD pod) are
    necessary for unambiguous FRs 1–7 (dark-factory integration). Stakeholders
    needing this level of detail (platform engineers, operators) are explicitly
    named in User Personas.
- [x] Focused on user value and business needs
  - Five personas (Platform Engineer, Developer, Product Owner, System, Actor)
    cover deployment, daily use, PR review, and automation.
  - Success Criteria SC1–SC11 tied to user workflows (onboarding latency,
    cost control, error visibility, local delegation).
- [x] All mandatory sections completed (Problem, Vision, Scenarios, FRs, NFRs,
  Out of Scope, Key Entities, Success Criteria, Assumptions, Dependencies)

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
  - FRs 1–17 are unambiguous and verifiable against acceptance criteria in
    Scenarios 1–5.
  - FR-6 supersession documented inline; no ambiguity.
- [x] Requirements are testable and unambiguous
  - Each FR has acceptance criteria in scenarios (e.g., FR-1 validated by
    Scenario 1, Acceptance Criteria 1–5).
  - Test anchors provided: `worker.onboard.test.ts:74`, `worker.onboard.test.ts:63`.
- [x] Success criteria are measurable
  - SC1: "multi-file PR on first attempt within 5 minutes"
  - SC3: "LLM costs under $0.10 per onboarding task"
  - SC6: "backlog of 10 pending tasks within 60 minutes"
  - SC7–SC11 use time bounds and user-outcome metrics.
- [x] Success criteria are technology-agnostic
  - "cost-effective model" (FR-3, SC3) stays agnostic; plan/implementation
    specify Haiku.
- [x] All acceptance scenarios (1–5) defined with flow and criteria
  - Scenario 1 (Pipeline Task): covers core worker flow with test anchors
  - Scenario 2 (Scheduled Jobs): covers hot-path job scheduling; ADR-019
    supersession noted inline
  - Scenario 3 (Observability): covers cost/duration logging
  - Scenario 4 (Edge Cases): covers crash recovery, malformed output, API
    rate limits, stale tasks
  - Scenario 5 (Feature Request): covers PM → spec generation flow (FR-9)
- [x] Edge cases identified
  - Repo doesn't exist (Scenario 4, AC 1)
  - LLM malformed output with retry (Scenario 4, AC 2)
  - GitHub API rate limit (Scenario 4, AC 3)
  - Pod restart during task (Scenario 4, AC 4)
  - Database reconnect (Scenario 4, AC 5)
- [x] Scope clearly bounded (Out of Scope section)
  - Multi-tenant isolation, interactive sessions, multi-model routing,
    task migration all explicitly out-of-scope.
- [x] Dependencies and assumptions identified
  - Postgres schema, GitHub App, LLM API key, Vertex AI, task-types.yaml,
    single-replica deployment — all listed.

## Implementation Status

### Core FRs 1–7 (Dark-Factory Supervisor)

- [x] **FR-1: Task Polling** — `apps/agent/src/application/jobs/worker.ts`
  polls pipeline.tasks, picks pending, prevents race via DB SELECT FOR UPDATE.
- [x] **FR-2: Direct LLM Integration** — `apps/agent/src/adapters/anthropic.ts`
  calls @anthropic-ai/sdk directly; model configurable per task type.
- [x] **FR-3: Repo Context Pre-Fetch** — `apps/agent/src/ports/CodePlatform`
  interface + GitHub implementation in `apps/agent/src/adapters/github.ts`;
  fetches tree, key files before LLM call.
- [x] **FR-4: Structured Output Parsing** — `apps/agent/src/application/services/output-parser.ts`
  parses JSON, retries on failure, falls back to single-file PR.
- [x] **FR-5: PR Creation Pipeline** — `apps/agent/src/adapters/github.ts`
  creates branches, commits files, opens PRs via Octokit.
- [x] **FR-6: Job Scheduling** (PARTIAL)
  - Hot-path jobs (merge-check, review-reactor safety net): in-process
    via `apps/agent/src/application/jobs/` scheduled with 60s / 5min ticks
  - Heavy batch jobs (reindex, gap-detect, spec-drift, memory-ttl):
    K8s CronJobs per ADR-019; no in-process scheduler needed for batch.
  - **Status**: Meets spec intent; batch move documented in FR-6 note.
- [x] **FR-7: Crash Recovery** — `apps/agent/src/application/startup.ts` resets
  tasks older than timeout; no stuck "running" state.

### Extended FRs 8–17 (Observability, Review, Memory, etc.)

- [x] **FR-8: Health and Metrics** — `apps/agent/src/ports/health.ts` exposes
  `/healthz`, task count, last job times, uptime.
- [x] **FR-9: Feature Request Translation** — `apps/agent/src/application/services/feature-request-handler.ts`
  generates spec.md, data-model.md, tasks.md with separate LLM calls.
- [x] **FR-10: Claude Code Headless Execution** — `apps/agent/src/application/jobs/implementation.ts`
  spawns `claude --print` in cloned repo; commits changes, opens PR.
- [x] **FR-11: Local Task Delegation** — `mcp-server/src/local-runner.ts`
  proxies `lore_create_pipeline_task` to GKE agent via HTTP when local DB missing.
- [x] **FR-12: Automatic Ingest Configuration** — `apps/agent/src/lib/secret-setup.ts`
  sets `LORE_INGEST_TOKEN` and `LORE_INGEST_URL` on target repo after onboarding PR.
- [x] **FR-13: GitHub Issue Sync** — `apps/agent/src/application/jobs/loretask-watcher.ts`
  creates GitHub Issues with `lore-managed` label; updates on status changes.
- [x] **FR-14: Review Reactor** — `apps/agent/src/application/jobs/review-reactor.ts`
  polls for review feedback every 5 minutes (webhook-triggered on GKE per ADR-015);
  max 3 iterations before escalating.
- [x] **FR-15: Platform Abstraction** — `apps/agent/src/ports/CodePlatform`
  interface; GitHub implementation in `adapters/github.ts`. Bidirectional:
  no changes needed to add new platform.
- [x] **FR-16: Optional Approval Gates** — `apps/agent/src/lib/approval.ts`
  checks for `approved` label on issues; task transitions to pending on match.
  Configured via settings UI or `lore.repos.settings.approval_required`.
- [x] **FR-17: Org-Wide Memory Sharing** — `mcp-server/src/memory-*.ts`
  proxies memory ops to GKE; file-backed fallback when proxy unreachable.
  Memories searchable org-wide.

### ADR Integration

- **ADR-016 (Dark-Factory Mode)**: Shaped FRs 1–7 directly.
  - Branch-as-state: supervisor emits `Lore-Stage:`, `Lore-Iteration:`,
    `Lore-Task:` trailers per `shared/src/commit-trailers.ts`.
  - Workflow YAML graph: loaded by supervisor from `agent/src/workflows/*.yaml`
    (gap-fill, general, implementation, review).
  - Two-key authZ: `mcp-server/src/dark-factory-authz.ts` validates privileged
    settings changes via CODEOWNERS ceremony.
  - Auto-merge: `apps/agent/src/jobs/auto-merge.ts` runs after retrospective
    stage; gated by path allowlist, trust level, CI status.
- **ADR-019 (Scheduled-Job-Runtime-Split)**: Modified FR-6.
  - Batch jobs (reindex, gap-detect, spec-drift, memory-ttl) now Kubernetes
    CronJobs in `terraform/modules/gke-mcp/`.
  - Spec FR-6 note updated to reflect change; acceptance criteria still met
    (jobs run at scheduled times, logged, no overlap).

## Validation Findings

### Completeness vs. Implementation

- **All 17 FRs implemented and deployed** to production GKE (`lore-agent`
  namespace).
- **Test anchors in spec matched to actual test files**:
  - `worker.onboard.test.ts:74` exists and validates FR-1 acceptance criterion
    (task moves from pending to pr-created).
  - `worker.onboard.test.ts:63` exists and validates FR-1 acceptance criterion
    (onboarding PRs contain individual files).
- **No implementation details leak into spec**. Technical terms (workflow YAML,
  supervisor, commit trailer) are justified as necessary for platform-engineer
  personas and documented in Key Entities.

### Success Criteria Tracking

- SC1 (multi-file PR on first attempt within 5 min): ✓ validated by tests
- SC2 (scheduled jobs reliable at configured times): ✓ K8s CronJob + in-process
  watchers
- SC3 (LLM costs < $0.10/task): ✓ Haiku default; audited in
  `apps/agent/src/lib/cost-tracking.ts`
- SC4 (zero tasks lost on restart): ✓ CR startup resets stale tasks
- SC5 (web UI visibility): ✓ `web-ui/src/app/pipeline/[id]/` timeline,
  cost dashboards
- SC6 (10 pending tasks within 60 min): ✓ 30s polling tick, sequential
  processing; latency < 5 min per task
- SC7 (PM feature requests within 10 min): ✓ FR-9 generates spec/data-model/tasks
- SC8 (local delegation): ✓ FR-11 proxies to GKE; no infra needed locally
- SC9 (review feedback within 10 min): ✓ FR-14 webhook-triggered (ADR-015) or
  5min cron safety net
- SC10 (auto-loaded context): ✓ `apps/agent/src/delivery/context-hydration.ts`
  pre-fetches before Claude Code spawn
- SC11 (org-wide memory): ✓ FR-17 org-wide search via proxy

## Known Gaps

1. **Performance scaling**: Spec assumes single-replica; no load testing for
   concurrent task volume >10. Matrix: 1 task/min nominal, 60/min burst
   (untested).
2. **GitLab/Bitbucket support**: FR-15 specifies platform abstraction, but
   only GitHub implemented. Bitbucket implementation deferred.
3. **Multi-region deployment**: Spec assumes single GKE cluster. Cross-region
   database replication not addressed.

## Notes

- Spec published 2026-03-29; shipped 2026-05-15 (6 weeks elapsed).
- ADR-016 (4/28) and ADR-019 (6/2) refined FRs in-flight; all changes reflected
  in spec.md via inline notes and versioned references.
- Checklist items all pass. Implementation assessment confirms no drift: all
  FRs implemented, acceptance criteria met, test anchors valid, ADR integration
  clean.
- Constitution Principle 7 (Architecture Decisions Are Final) satisfied via
  ADR-007, ADR-016, and ADR-019 recording agent-runtime decisions and trade-offs.
