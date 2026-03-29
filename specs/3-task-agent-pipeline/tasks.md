# Tasks: Task-to-Agent Pipeline

| Field   | Value                                |
|---------|--------------------------------------|
| Feature | Task-to-Agent Pipeline               |
| Branch  | 3-task-agent-pipeline                |
| Plan    | [plan.md](plan.md)                   |
| Spec    | [spec.md](spec.md)                   |
| Created | 2026-03-29                           |

## User Story Map

| Story | Spec Scenario                | Priority | Phase |
|-------|------------------------------|----------|-------|
| US1   | UI Task → Agent → PR         | P1       | 1-2   |
| US2   | Spec PR → Agent Implements   | P2       | 2     |
| US3   | MCP Tool → Agent             | P1       | 1     |
| US4   | Agent Reviews Agent          | P3       | 2     |
| US5   | Task Progress Tracking       | P1       | 1-3   |

---

## Phase 1: Setup

- [x] T001 Create pipeline schema DDL script in scripts/infra/setup-pipeline-schema.sh (pipeline.tasks + pipeline.task_events tables with indexes, updated_at trigger, grant to lore user)
- [x] T002 Run schema DDL on the existing lore database
- [x] T003 [P] Create task type config file in scripts/task-types.yaml with types: general, runbook, implementation, gap-fill (each with prompt_template, target_repo, timeout, review_required)
- [x] T004 [P] Add octokit and @octokit/auth-app to mcp-server/package.json dependencies

---

## Phase 2: Foundational — Pipeline Modules

- [x] T005 Create mcp-server/src/pipeline-config.ts: load and parse task-types.yaml, export getTaskTypeConfig(type) function, reload on SIGHUP
- [x] T006 Create mcp-server/src/pipeline-github.ts: GitHub App auth (generate installation token from APP_ID + PRIVATE_KEY env), create branch, commit files, open PR, add label, post review comment. All via octokit REST.
- [x] T007 Create mcp-server/src/pipeline.ts: task CRUD (createTask, getTask, listTasks, cancelTask, updateTaskStatus), task event recording (recordEvent), poller (pollPendingTasks — query every 10s, spawn agents, respect max 5 concurrent), agent spawner (buildContextBundle + call Klaus)

---

## Phase 3: US3 — MCP Tool → Agent [P1]

### Story Goal
Developer calls delegate_task or create_pipeline_task, agent spawns
on GKE, does the work, task status trackable via MCP.

### Independent Test Criteria
- create_pipeline_task returns task_id with status pending.
- Poller picks up pending task within 10 seconds.
- Agent spawned via Klaus with context bundle.
- get_pipeline_status returns current status and events.

### Tasks

- [x] T008 [US3] Register create_pipeline_task MCP tool in mcp-server/src/index.ts: calls createTask from pipeline.ts, validates task_type against config
- [x] T009 [US3] Register get_pipeline_status MCP tool in mcp-server/src/index.ts: returns task with full event history
- [x] T010 [US3] Register list_pipeline_tasks MCP tool in mcp-server/src/index.ts: filterable by status, paginated
- [x] T011 [US3] Register cancel_task MCP tool in mcp-server/src/index.ts: transitions to cancelled, kills agent if running
- [x] T012 [US3] Start the poller in main() function of index.ts: call pollPendingTasks every 10s after server starts, log poll cycle to console
- [x] T013 [US3] Wire agent spawner in pipeline.ts: on pending task found, check concurrent count < 5, transition to queued → running, call Klaus with task prompt + context bundle

---

## Phase 4: US1 — UI Task → Agent → PR [P1]

### Story Goal
Product owner creates task in UI, agent picks it up, works, opens PR.
PO sees PR link in the UI.

### Independent Test Criteria
- Task created via UI appears in pipeline.tasks with status pending.
- Agent spawns within 2 minutes.
- Agent creates branch and opens PR on target repo.
- PR labelled agent-generated.
- Task status shows pr-created with PR URL.

### Tasks

- [x] T014 [US1] Implement PR creation in pipeline-github.ts: after agent completes, create branch agent/<task-id>/<slug>, commit agent output, open PR with structured description (task link, context refs), label agent-generated
- [x] T015 [US1] Add agent completion handler in pipeline.ts: when Klaus reports task done, call pipeline-github to create PR, update task status to pr-created with pr_url
- [x] T016 [US1] Add agent failure handler in pipeline.ts: when Klaus reports failure or timeout, update task status to failed with failure_reason
- [x] T017 [P] [US1] Create web-ui/src/app/pipeline/create/page.tsx: task creation form with description textarea, task type selector (loaded from task-types.yaml via API), target repo input, submit button (Server Action writes to pipeline.tasks)
- [x] T018 [P] [US1] Create web-ui/src/app/pipeline/page.tsx: pipeline dashboard listing all tasks with status badge, agent ID, PR link, created time, filterable by status
- [x] T019 [US1] Create web-ui/src/app/pipeline/[id]/page.tsx: task detail page with full event timeline, agent logs, PR link, cancel button

---

## Phase 5: US2 — Spec PR → Agent Implements [P2]

### Story Goal
Developer pushes spec to a branch, GitHub Action detects it and
creates a pipeline task, agent implements the spec.

### Independent Test Criteria
- PR with .specify/ files triggers a GitHub Action.
- Action creates a pipeline task via MCP endpoint.
- Agent reads the spec and implements code.
- Implementation committed to the same branch or child branch.

### Tasks

- [x] T020 [US2] Create .github/workflows/spec-agent.yml: triggered on PR with paths .specify/**, calls create_pipeline_task via MCP HTTP endpoint with task_type=implementation and spec content as context
- [x] T021 [US2] Add spec-to-task context builder in pipeline.ts: when task_type=implementation, read the spec file from the PR branch and include in context bundle
- [x] T022 [US2] Configure implementation task type in scripts/task-types.yaml: prompt template that instructs agent to read spec, generate plan, implement code, commit to branch

---

## Phase 6: US4 — Agent Reviews Agent [P3]

### Story Goal
Agent-generated PR triggers a review agent that checks against
Lore context. Max 2 iterations, then escalate to human.

### Independent Test Criteria
- PR labelled agent-generated triggers review agent.
- Review agent posts PR comments.
- If changes requested, original agent re-runs (iteration 1).
- After 2 iterations, escalates to human.

### Tasks

- [x] T023 [US4] Create .github/workflows/agent-review.yml: triggered on PR labelled agent-generated, calls create_pipeline_task with task_type=review and PR URL as context
- [x] T024 [US4] Add review task type to scripts/task-types.yaml: prompt template instructs agent to review PR against ADRs, conventions, and original spec, post comments via GitHub API
- [x] T025 [US4] Implement review iteration logic in pipeline.ts: track review_iteration on task, if review agent requests changes → create new implementation task (iteration+1), if iteration >= 2 → add label needs-human-review and stop
- [x] T026 [US4] Add review comment posting to pipeline-github.ts: post review comments on PR, request changes or approve

---

## Phase 7: US5 — Task Progress Tracking [P1]

### Story Goal
Task status visible in real-time from creation to PR merge, in
both UI and MCP.

### Independent Test Criteria
- Every state transition recorded as TaskEvent.
- UI dashboard auto-refreshes and shows current status.
- Failed tasks show failure reason.
- Cancelled tasks show who cancelled and when.

### Tasks

- [x] T027 [US5] Add status webhook listener in pipeline.ts: when Klaus reports status changes (running, completed, failed), call recordEvent and updateTaskStatus
- [x] T028 [US5] Add PR merge detection: GitHub webhook or polling that detects when agent-generated PR is merged, transitions task to merged status
- [x] T029 [P] [US5] Add auto-refresh to web-ui/src/app/pipeline/page.tsx: client component that polls get_pipeline_status every 5s for active tasks
- [x] T030 [US5] Update web-ui/src/app/pipeline/[id]/page.tsx: show full event timeline with timestamps, failure_reason display, cancel button functionality

---

## Phase 8: Polish & Cross-Cutting Concerns

- [x] T031 Rebuild and push MCP server image with pipeline modules
- [x] T032 Deploy pipeline schema to GKE database (run setup-pipeline-schema.sh)
- [x] T033 Deploy updated MCP server to GKE
- [x] T034 Build and push updated web-ui with pipeline pages
- [x] T035 Create GitHub App for re-cinq org, store APP_ID + PRIVATE_KEY as K8s secrets in mcp-servers namespace
- [x] T036 Update CLAUDE.md to document pipeline tools and task types
- [x] T037 Update web-ui layout.tsx sidebar to include Pipeline nav link
- [x] T038 Add pipeline status check to lore-doctor.sh (pending task count, running agent count)

---

## Dependencies

```
Phase 1 (Setup: schema + config + deps)
  └── Phase 2 (Foundational: config loader + GitHub module + pipeline core)
        ├── Phase 3 (US3: MCP tools + poller + spawner) ── T008-T013
        │     └── Phase 4 (US1: PR creation + UI) ── T014-T019
        │           └── Phase 5 (US2: Spec PR trigger) ── T020-T022
        │                 └── Phase 6 (US4: Review agent) ── T023-T026
        └── Phase 7 (US5: Status tracking) ── T027-T030
```

## Parallel Execution Opportunities

### Phase 1-2 (Days 1-2)
```
Agent A: T001, T002 (schema)
Agent B: T003 (task-types.yaml) [P]
Agent C: T004 (package.json deps) [P]
Then:
Agent A: T005 (config loader)
Agent B: T006 (GitHub module) [P]
Agent C: T007 (pipeline core) [P after T005]
```

### Phase 3 (Days 3-4)
```
Agent A: T008-T011 (register 4 MCP tools)
Agent B: T012 (start poller in main)
Agent C: T013 (wire agent spawner)
```

### Phase 4 (Days 5-7)
```
Agent A: T014-T016 (PR creation + completion/failure handlers)
Agent B: T017 (UI create page) [P]
Agent C: T018 (UI dashboard) [P]
Agent D: T019 (UI detail page)
```

### Phase 5-6 (Days 8-9)
```
Agent A: T020-T022 (spec PR trigger) [P]
Agent B: T023-T026 (review agent) [P]
```

### Phase 7 (Day 10)
```
Agent A: T027-T028 (status handlers)
Agent B: T029-T030 (UI updates) [P]
```

## Implementation Strategy

### MVP (Phase 1-3, ~4 days)
- T001-T013: Pipeline schema, config, poller, spawner, 4 MCP tools.
- Gate: create_pipeline_task → agent spawns → task_status shows running.

### Phase 2 Increment (Phase 4-5, ~4 days)
- T014-T022: PR creation, UI dashboard, spec PR trigger.
- Gate: UI task → agent → PR opened on GitHub.

### Phase 3 Increment (Phase 6-7, ~2 days)
- T023-T030: Review agent, iteration logic, status tracking.
- Gate: agent PR → review agent → comments posted.

### Polish (~2 days)
- T031-T038: Build, deploy, GitHub App setup, docs.

## Summary

| Metric                       | Value |
|------------------------------|-------|
| Total tasks                  | 38    |
| Phase 1 (Setup) tasks       | 4     |
| Phase 2 (Foundational) tasks | 3     |
| US3 (MCP → Agent) tasks     | 6     |
| US1 (UI → Agent → PR) tasks | 6     |
| US2 (Spec PR → Agent) tasks | 3     |
| US4 (Review Agent) tasks    | 4     |
| US5 (Status Tracking) tasks | 4     |
| Polish tasks                 | 8     |
| Parallelizable tasks ([P])  | 10    |
| User stories covered         | 5/5   |
