# Tasks: Lore Agent Service

| Field   | Value                |
|---------|----------------------|
| Feature | Lore Agent Service   |
| Branch  | 5-lore-agent         |
| Tasks   | 31                   |
| Phases  | 6                    |

---

## Phase 1: Setup

- [x] T001 Create agent/package.json with dependencies: @anthropic-ai/sdk, octokit, @octokit/auth-app, pg, yaml, cron-parser in agent/package.json
- [x] T002 Create agent/tsconfig.json with ESM strict ES2022 config in agent/tsconfig.json
- [x] T003 Create database pool and query helpers in agent/src/db.ts
- [x] T004 Create DB migration script for pipeline.llm_calls and pipeline.job_runs tables in scripts/infra/setup-agent-schema.sh

## Phase 2: Foundational

- [x] T005 [P] Implement Anthropic SDK wrapper with cost logging in agent/src/anthropic.ts
- [x] T006 [P] Implement config loader for task-types.yaml with model override support in agent/src/config.ts
- [x] T007 [P] Implement GitHub App operations (branch, commit, PR) adapted from mcp-server/src/pipeline-github.ts in agent/src/github.ts
- [x] T008 [P] Implement repo context pre-fetch adapted from mcp-server/src/repo-onboard.ts in agent/src/repo-context.ts
- [x] T009 [P] Implement JSON output parser with string-aware brace matching in agent/src/output.ts

## Phase 3: Task Processing [US1]

Goal: Pipeline tasks are picked up, processed via LLM, and turned into PRs automatically.

Test criteria: Insert a pending onboard task → agent picks it up → creates multi-file PR within 5 minutes.

- [x] T010 [US1] Implement task worker with polling loop, crash recovery, and sequential processing in agent/src/worker.ts
- [x] T011 [US1] Implement onboard task handler: pre-fetch context, call LLM with JSON system prompt, parse files, commit individually in agent/src/worker.ts
- [x] T012 [US1] Implement general/runbook/implementation task handlers: call LLM, create single-file PR in agent/src/worker.ts
- [x] T013 [US1] Implement retry logic: on JSON parse failure, retry once with simplified prompt, then fall through to single-file in agent/src/worker.ts
- [x] T014 [US1] Implement entry point: init DB pool, run crash recovery, start worker, start health server in agent/src/index.ts
- [x] T029 [US1] Implement feature-request handler: pre-fetch context, generate spec/data-model/tasks per-file, create PR in agent/src/worker.ts
- [x] T030 [US1] Add feature-request task type to scripts/task-types.yaml
- [x] T031 [US1] Add Feature Request option to task create UI in web-ui/src/app/repos/[owner]/[repo]/tasks/create/page.tsx

## Phase 4: Scheduled Jobs [US2]

Goal: All 5 periodic maintenance jobs run on schedule with DB persistence and missed-run recovery.

Test criteria: Start service → jobs execute at configured times → job_runs table has entries with status and duration.

- [x] T015 [US2] Implement cron scheduler with 30s tick, DB persistence, missed-run detection, no-overlap guard in agent/src/scheduler.ts
- [x] T016 [P] [US2] Implement merge check job: detect merged onboarding PRs, update lore.repos in agent/src/jobs/merge-check.ts
- [x] T017 [P] [US2] Implement memory TTL cleanup job: delete expired memories in agent/src/jobs/ttl-cleanup.ts
- [x] T018 [P] [US2] Implement context reindex job: fetch changed files, re-embed via Vertex AI for all repos in agent/src/jobs/reindex.ts
- [x] T019 [P] [US2] Implement gap detection job: compare repo structure vs CLAUDE.md via LLM, create gap-fill tasks in agent/src/jobs/gap-detect.ts
- [x] T020 [P] [US2] Implement spec drift job: compare spec vs code via LLM, create drift tasks in agent/src/jobs/spec-drift.ts
- [x] T021 [US2] Register all 5 jobs in scheduler and wire into index.ts entry point in agent/src/index.ts

## Phase 5: Observability [US3]

Goal: Health endpoint returns service metrics; LLM costs are queryable per task.

Test criteria: GET /healthz returns JSON with uptime, task counts, job schedules, and DB status.

- [x] T022 [US3] Implement HTTP health endpoint with uptime, task stats, job run times, DB status in agent/src/health.ts
- [x] T023 [US3] Wire health server into index.ts on configurable port (default 8080) in agent/src/index.ts

## Phase 6: Deployment & Cutover

- [x] T024 Create multi-stage Dockerfile (builder + slim runner) in agent/Dockerfile
- [x] T025 [P] Create Helm chart: deployment, service, serviceaccount, configmap, secrets in terraform/modules/gke-mcp/agent-helm/
- [x] T026 [P] Create GitHub Actions CI workflow for agent build+push in .github/workflows/build-agent.yml
- [x] T027 Remove Klaus pipeline poller, Klaus client, merge checker, and onboarding PR interval from MCP server in mcp-server/src/index.ts
- [x] T028 Write ADR documenting Klaus replacement with rationale in adrs/ADR-007-lore-agent-replaces-klaus.md

---

## Dependencies

```
Phase 1 (Setup) ──→ Phase 2 (Foundational) ──→ Phase 3 (US1: Task Processing)
                                              ──→ Phase 4 (US2: Scheduled Jobs)
                                              ──→ Phase 5 (US3: Observability)
Phase 3 + 4 + 5 ──→ Phase 6 (Deployment & Cutover)
```

- US1, US2, US3 can be developed in parallel after Phase 2
- Phase 6 requires all user stories complete

## Parallel Execution

### Within Phase 2 (all [P]):
T005, T006, T007, T008, T009 — independent modules, different files

### Within Phase 4:
T016, T017, T018, T019, T020 — independent job handlers, different files

### Within Phase 6:
T025, T026 — Helm chart and CI workflow are independent

## Implementation Strategy

**MVP:** Phase 1 + Phase 2 + Phase 3 (US1: Task Processing)
- This alone replaces Klaus for the critical onboarding flow
- 14 tasks, ~2 days

**Full:** Add Phase 4 (US2: Scheduler) + Phase 5 (US3: Health)
- Replaces all CronJobs and adds observability
- 9 more tasks, ~1.5 days

**Cutover:** Phase 6
- Deploy, verify, remove Klaus
- 5 tasks, ~0.5 days
