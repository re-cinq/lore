# Implementation Plan: Task-to-Agent Pipeline

| Field        | Value                                           |
|--------------|-------------------------------------------------|
| Feature      | Task-to-Agent Pipeline                          |
| Branch       | 3-task-agent-pipeline                           |
| Spec         | [spec.md](spec.md)                              |
| Constitution | [constitution.md](../../.specify/memory/constitution.md) |
| Status       | Draft                                           |
| Created      | 2026-03-29                                      |

## Technical Context

### Stack

| Layer                      | Technology                                         | Phase |
|----------------------------|----------------------------------------------------|-------|
| Task pipeline DB schema    | PostgreSQL (`pipeline` schema in existing CNPG `lore-db-1`) | 1 |
| Task poller + spawner      | TypeScript (extends `mcp-server/src/index.ts`)     | 1 |
| Klaus integration          | Existing `klaus-client.ts` extended with task context | 1 |
| GitHub App auth            | `octokit` + `@octokit/auth-app` (installation tokens) | 1 |
| Task type config           | YAML file in context repo (`scripts/task-types.yaml`) | 1 |
| Pipeline MCP tools         | TypeScript (new `mcp-server/src/pipeline.ts`)      | 1 |
| PR creation                | `octokit` REST API (branch, commit, PR)            | 2 |
| Review agent               | Klaus spawning with review prompt template         | 2 |
| Web UI pages               | Next.js (extends existing `web-ui/`)               | 3 |

### Key Dependencies

| Dependency                          | Purpose                           | Risk |
|-------------------------------------|-----------------------------------|------|
| Existing CNPG `lore-db-1`          | Task state storage                | Low -- already operational |
| Existing `klaus-client.ts`         | Agent spawning HTTP client        | Low -- verified with `delegate_task` |
| Existing `context-bundle.ts`       | Task context assembly             | Low -- already wired |
| GitHub App (org-level install)     | Branch + PR creation, repo access | Medium -- requires App setup |
| `@octokit/auth-app`               | Short-lived installation tokens   | Low -- well-maintained library |
| Lore MCP server (HTTP transport)   | Agent access to context + memory  | Low -- deployed on GKE |
| Web UI (Next.js)                   | Task dashboard + creation form    | Low -- exists from Feature 2 |

### Repository Structure Additions

```
mcp-server/src/
  index.ts              # Extended with pipeline tool registrations + poller start
  klaus-client.ts       # Extended with task-context-aware spawning
  pipeline.ts           # NEW: task CRUD, poller, spawner, status management
  pipeline-github.ts    # NEW: GitHub App auth, branch creation, PR creation
  pipeline-config.ts    # NEW: task type config loader (YAML)

scripts/
  task-types.yaml       # NEW: task type definitions (prompt templates, timeouts)
  infra/
    setup-pipeline-schema.sh  # NEW: DDL for pipeline.tasks + pipeline.task_events

web-ui/src/app/
  pipeline/
    page.tsx            # NEW: task pipeline dashboard
    create/
      page.tsx          # NEW: task creation form
    [id]/
      page.tsx          # NEW: task detail with event timeline

specs/3-task-agent-pipeline/
  plan.md               # THIS FILE
  research.md           # Research decisions
  data-model.md         # Entity definitions
  contracts/
    mcp-tools.md        # MCP tool interface contracts
```

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| P1: DX-First Delivery | PASS | Pipeline tools work via MCP from day one. UI is Phase 3 -- pipeline is functional via `create_pipeline_task` MCP tool before any UI exists. |
| P2: Zero Stored Credentials | PASS | GitHub App uses short-lived installation tokens generated per agent run. No PATs, no stored secrets. App private key injected via Workload Identity on GKE. |
| P3: PR Quality Gates | PASS | Agent-generated PRs include structured descriptions (summary, task link, context references). PR template enforced by existing CI check. |
| P4: Three-Command Interface | PASS | Developers do not need new commands. `delegate_task` already exists -- pipeline routes it through the task lifecycle automatically. |
| P5: Single Interface (Lore MCP) | PASS | All pipeline interactions go through Lore MCP tools. Web UI reads from the same PostgreSQL. No separate pipeline API. |
| P6: Distributed Ownership | N/A | Pipeline is platform infrastructure, not team-owned content. |
| P7: Architecture Final | PASS | Uses existing PostgreSQL, existing GKE cluster, existing Klaus. No new infrastructure decisions. GitHub App is an integration, not an architecture choice. |
| P8: Schema Isolation | PASS | Pipeline tables live in a dedicated `pipeline` schema. No interference with `org_shared`, `memory`, or team schemas. |
| P9: Agents Over Scripts | PASS | Tasks spawn Klaus agents that reason about context, not mechanical scripts. Review agent checks against ADRs and conventions semantically. |
| P10: Opt-In Data | N/A | Pipeline does not index personal content. Task descriptions are user-created and explicitly submitted. |

No constitution violations. All applicable gates pass.

## Implementation Phases

### Phase 1: Task Pipeline Core (1 week)

#### 1.1 PostgreSQL Schema

**File:** `specs/3-task-agent-pipeline/contracts/db-schema.md` (DDL), applied via `scripts/infra/setup-pipeline-schema.sh`

All tables in a `pipeline` schema within the existing `lore` database on `lore-db-1`.

**`pipeline.tasks`** -- core task lifecycle table.

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, `gen_random_uuid()` |
| description | TEXT | NOT NULL |
| task_type | TEXT | NOT NULL, DEFAULT 'general' |
| status | TEXT | NOT NULL, DEFAULT 'pending' |
| target_repo | TEXT | NOT NULL |
| target_branch | TEXT | Nullable (set when agent creates branch) |
| agent_id | TEXT | Nullable (set when agent starts) |
| pr_url | TEXT | Nullable (set when PR created) |
| pr_number | INTEGER | Nullable |
| review_iteration | INTEGER | DEFAULT 0 |
| context_bundle | JSONB | Task description, spec, seed query |
| failure_reason | TEXT | Nullable |
| created_by | TEXT | NOT NULL ('ui', 'mcp', agent ID) |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

- Index on `(status)` for poller queries.
- Index on `(created_at)` for dashboard ordering.
- Index on `(agent_id)` for agent lookups.

**`pipeline.task_events`** -- append-only state transition log.

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, `gen_random_uuid()` |
| task_id | UUID | FK to tasks.id, NOT NULL |
| from_status | TEXT | Nullable (null for initial creation) |
| to_status | TEXT | NOT NULL |
| metadata | JSONB | Nullable (agent logs, PR URL, error details) |
| created_at | TIMESTAMPTZ | DEFAULT now() |

- Index on `(task_id, created_at)` for event timeline queries.

**Verification:** `setup-pipeline-schema.sh` creates both tables. `\dt pipeline.*` shows both tables in psql.

#### 1.2 Task Type Configuration

**File:** `scripts/task-types.yaml`, `mcp-server/src/pipeline-config.ts`

YAML file loaded once on MCP server startup. Reloaded on SIGHUP for hot-reload without restart.

```yaml
task_types:
  general:
    prompt_template: "Complete the following task using Lore context..."
    target_repo: "re-cinq/lore"
    timeout_minutes: 30
    review_required: true
  runbook:
    prompt_template: "Write a runbook for..."
    target_repo: "re-cinq/lore"
    timeout_minutes: 20
    review_required: true
  implementation:
    prompt_template: "Implement the following spec..."
    timeout_minutes: 45
    review_required: true
  gap-fill:
    prompt_template: "Draft missing context for..."
    target_repo: "re-cinq/lore"
    timeout_minutes: 15
    review_required: false
```

`pipeline-config.ts` exports:
1. `loadTaskTypes(path: string): TaskTypeConfig` -- parse YAML, validate required fields.
2. `getTaskType(name: string): TaskType | undefined` -- lookup by name.
3. `getDefaultTaskType(): TaskType` -- returns `general`.

**Verification:** Server starts with valid YAML. Invalid YAML causes startup failure with clear error.

#### 1.3 Task Poller

**File:** `mcp-server/src/pipeline.ts`

A `setInterval` loop running every 10 seconds inside the MCP server process:

1. Query `pipeline.tasks WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`.
2. Check running agent count: `SELECT count(*) FROM pipeline.tasks WHERE status IN ('running', 'queued')`.
3. If running count >= `MAX_CONCURRENT_AGENTS` (default 5, configurable via `LORE_MAX_AGENTS`), skip.
4. If a pending task is found and a slot is available:
   a. Transition task to `queued` (insert event).
   b. Build context bundle using `context-bundle.ts`.
   c. Submit to Klaus via `submitTask()` from `klaus-client.ts`.
   d. On success: transition to `running`, set `agent_id` from Klaus response.
   e. On failure: transition to `failed`, set `failure_reason`.
5. Deduplication: the poller uses `SELECT ... FOR UPDATE SKIP LOCKED` to prevent two poller instances (if running) from picking up the same task.

The poller starts automatically in `main()` after the MCP server is initialized, but only when `LORE_DB_HOST` is set (pipeline requires PostgreSQL).

**Verification:** Create a task via SQL insert, poller picks it up within 10 seconds and calls Klaus.

#### 1.4 Agent Spawner

**File:** `mcp-server/src/pipeline.ts` (same module as poller)

Extends the existing `submitTask()` call from `klaus-client.ts` with pipeline-specific context:

1. Resolve task type config from `pipeline-config.ts`.
2. Build prompt: task type's `prompt_template` + task `description` + context bundle.
3. Generate GitHub App installation token (from `pipeline-github.ts`).
4. Submit to Klaus with: prompt, context bundle, target repo, branch name pattern (`agent/<task-id>/<slug>`), GitHub token, timeout.
5. Store the Klaus `task_id` as `agent_id` on the pipeline task.

**Verification:** Task transitions from `pending` to `queued` to `running`. Klaus receives the submission. Agent ID is recorded.

#### 1.5 GitHub App Token Generation

**File:** `mcp-server/src/pipeline-github.ts`

```typescript
// Uses @octokit/auth-app to create short-lived installation tokens.
// App ID + private key loaded from environment (injected via K8s Secret).
// Installation ID resolved once on startup via listInstallations().
```

Environment variables:
- `GITHUB_APP_ID`: GitHub App numeric ID.
- `GITHUB_APP_PRIVATE_KEY`: PEM-encoded private key (from K8s Secret, injected via Workload Identity).
- `GITHUB_APP_INSTALLATION_ID`: optional, resolved automatically if omitted.

Exports:
1. `getInstallationToken(repos?: string[]): Promise<string>` -- returns a short-lived token scoped to the specified repos (or all configured repos if omitted).
2. `getOctokit(): Promise<Octokit>` -- returns an authenticated Octokit instance.

**Verification:** `getInstallationToken()` returns a valid token. Token expires after 1 hour. Calls to GitHub API succeed with the token.

#### 1.6 Pipeline MCP Tools

**File:** `mcp-server/src/pipeline.ts` (tool registrations), `mcp-server/src/index.ts` (imports)

Four new tools registered in `index.ts`:

- `create_pipeline_task` -- create a task, returns `{ task_id, status: 'pending' }`.
- `get_pipeline_status` -- get task status + events.
- `list_pipeline_tasks` -- list tasks with optional status filter.
- `cancel_task` -- cancel a task, kill running agent if active.

Full contracts in [contracts/mcp-tools.md](contracts/mcp-tools.md).

**Verification:**
- `create_pipeline_task(description: "Write a runbook for auth flow", task_type: "runbook")` returns a task ID.
- `get_pipeline_status(task_id)` shows status progression.
- `list_pipeline_tasks(status: "running")` returns active tasks.
- `cancel_task(task_id)` transitions to cancelled.

#### 1.7 Phase 1 Verification

End-to-end:
1. MCP server starts, loads task type config, starts poller.
2. Call `create_pipeline_task(description: "Write auth runbook")`.
3. Poller picks up task within 10 seconds.
4. Task transitions: `pending` -> `queued` -> `running`.
5. Klaus receives the submission with correct prompt + context.
6. `get_pipeline_status` shows running state with agent ID.
7. `list_pipeline_tasks` shows the task.
8. `cancel_task` stops the task.
9. Concurrency: create 6 tasks, first 5 go to running, 6th stays pending.

---

### Phase 2: PR Creation + Review (1 week)

#### 2.1 Agent Output Handler

**File:** `mcp-server/src/pipeline.ts`

When a Klaus agent completes (detected via status polling on the Klaus side):

1. Poller checks `running` tasks every 10 seconds against Klaus status API.
2. On completion:
   a. Retrieve agent output from Klaus (`getTaskResult()`).
   b. Create branch `agent/<task-id>/<slug>` on target repo via GitHub API.
   c. Commit agent output to the branch.
   d. Create PR with structured description:
      - Summary of what the agent did.
      - Link to the original task.
      - Context references (ADRs, specs used).
   e. Label the PR `agent-generated`.
   f. Transition task to `pr-created`, set `pr_url` and `pr_number`.
3. On failure:
   a. Transition task to `failed`, set `failure_reason` from Klaus error.
   b. Record agent logs in task event metadata.

**Verification:** Agent completes, PR appears on GitHub with correct labels and description.

#### 2.2 PR Creation via GitHub App

**File:** `mcp-server/src/pipeline-github.ts`

Extends the GitHub module with PR creation functions:

1. `createBranch(repo, baseBranch, newBranch)` -- creates a ref via GitHub API.
2. `commitFiles(repo, branch, files, message)` -- creates a tree + commit via GitHub API.
3. `createPullRequest(repo, head, base, title, body, labels)` -- creates a PR with labels.

All operations use the installation token from `getInstallationToken()`.

**Verification:** Branch created, files committed, PR opened with `agent-generated` label.

#### 2.3 Review Agent Trigger

**File:** `mcp-server/src/pipeline.ts`

After a task transitions to `pr-created`:

1. Check task type config: if `review_required` is true, trigger review.
2. Create a review task internally (not a new pipeline task -- an internal sub-operation).
3. Build review prompt: "Review this PR against the original task, relevant ADRs, and team conventions. Post specific, actionable comments."
4. Submit review agent to Klaus with: PR diff, original task description, relevant Lore context.
5. Transition task to `review`.

#### 2.4 Review Agent Logic

The review agent:
1. Reads the PR diff via GitHub API.
2. Searches Lore context for relevant ADRs and conventions.
3. Compares implementation against spec/task description.
4. Posts review comments on the PR via GitHub API.
5. If no issues: approves (but human approval still required for merge).
6. If issues found: requests changes with specific comments.

#### 2.5 Iteration Logic

**Max 2 iterations:** implement -> review -> revise -> final review.

1. After review agent requests changes:
   a. Increment `review_iteration` on the task.
   b. If `review_iteration < 2`: re-trigger the implementation agent with review feedback.
   c. If `review_iteration >= 2`: transition to `failed` with reason "review escalation -- human intervention required". Add a comment on the PR tagging the task creator.

**Verification:** Agent creates PR, review agent posts comments, implementation agent revises, final review passes or escalates.

#### 2.6 Status Updates

New transitions active in Phase 2:
- `running` -> `pr-created` (agent output handled, PR opened)
- `pr-created` -> `review` (review agent triggered)
- `review` -> `running` (revision triggered, iteration < 2)
- `review` -> `merged` (PR merged, detected via GitHub webhook or polling)
- `review` -> `failed` (max iterations exceeded)

**Verification:** Task event timeline shows full lifecycle with timestamps.

#### 2.7 Phase 2 Verification

End-to-end:
1. Create task via MCP tool.
2. Agent runs, creates PR.
3. Review agent posts comments.
4. Agent revises and pushes update.
5. Final review passes.
6. Human merges the PR.
7. Task transitions to `merged`.
8. Full event timeline visible via `get_pipeline_status`.
9. Second test: agent fails review twice, task escalates to human with context.

---

### Phase 3: UI Integration (3-4 days)

#### 3.1 Task Creation Form (`/pipeline/create`)

**File:** `web-ui/src/app/pipeline/create/page.tsx`

Form fields:
- Task description (textarea, required).
- Task type (dropdown, populated from `scripts/task-types.yaml` loaded server-side).
- Target repo (dropdown, populated from GitHub App installation repos).
- Additional context (textarea, optional -- appended to context bundle).

Submit: inserts into `pipeline.tasks` via server action. Redirects to task detail page.

#### 3.2 Task Pipeline Dashboard (`/pipeline`)

**File:** `web-ui/src/app/pipeline/page.tsx`

Table columns: task ID (short UUID), description (truncated), type, status (badge), target repo, agent ID, PR link, created at.

Features:
- Filter by status (tabs: all, pending, running, pr-created, review, merged, failed).
- Auto-refresh every 10 seconds (client-side polling or `revalidate`).
- Click row to open task detail.

#### 3.3 Task Detail (`/pipeline/[id]`)

**File:** `web-ui/src/app/pipeline/[id]/page.tsx`

Sections:
- Task metadata: description, type, status, target repo, agent ID, PR link.
- Event timeline: vertical timeline of all `task_events`, each showing from/to status, timestamp, and metadata.
- Agent output: if task has a PR, embed a link to the PR diff.
- Cancel button: visible for non-terminal states (pending, queued, running).

#### 3.4 Integration with Agent Memory

When an agent completes a task:
1. Agent writes a memory entry via `write_memory` with key `pipeline.task.<task-id>`.
2. Memory value includes: what was done, files changed, context used.
3. This memory is searchable -- future agents can find what previous agents did on similar tasks.

#### 3.5 Phase 3 Verification

- Product owner creates a task via `/pipeline/create`.
- Dashboard shows the task progressing through states.
- Task detail shows the event timeline.
- PR link is clickable and opens GitHub.
- Cancel button works for a running task.
- Auto-refresh shows status changes within 10 seconds.
- Page load times under 500ms (server-rendered).

## Risk Register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Klaus agent fails silently (no status update) | Medium | Medium | Timeout handler in poller: if a running task exceeds its configured timeout, transition to `failed` with reason "agent timeout". Check every poll cycle. |
| GitHub App rate limiting | Medium | Low | Installation tokens have 5000 req/hour. Pipeline creates ~1 PR per task. At max 5 concurrent agents, well within limits. Monitor via `x-ratelimit-remaining` header. |
| Poller misses a task (DB connection drop) | Medium | Low | Poller reconnects on next cycle (10s). `pg.Pool` handles reconnection automatically. Task stays in `pending` until picked up -- no data loss. |
| Review agent produces low-quality reviews | Medium | Medium | Start with `review_required: false` for low-risk task types (gap-fill). Enable reviews incrementally. Human can always override. |
| Multiple MCP server instances run pollers | High | Medium | `SELECT ... FOR UPDATE SKIP LOCKED` prevents double-pickup. Each task is claimed atomically. Multiple pollers increase throughput without conflicts. |
| GitHub App private key compromise | High | Low | Key stored in K8s Secret, injected via Workload Identity. Rotatable via GitHub App settings. Short-lived tokens (1 hour) limit blast radius. |
| Agent creates PR on wrong branch/repo | Medium | Low | Target repo validated against GitHub App installation repos on task creation. Branch naming enforced by convention (`agent/<task-id>/...`). |
| Task queue grows unbounded during outage | Low | Low | `list_pipeline_tasks(status: 'pending')` visible in dashboard. Alert on pending count > 20 via existing Cloud Monitoring. |

## Critical Path

```
Pipeline schema DDL (Phase 1, day 1)
  -> Task type config loader (Phase 1, day 1)
    -> GitHub App token module (Phase 1, day 2)
      -> Task poller + spawner (Phase 1, day 2-3)
        -> Pipeline MCP tools (Phase 1, day 3-4)
          -> Agent output handler + PR creation (Phase 2, day 1-2)
            -> Review agent trigger + iteration logic (Phase 2, day 3-4)
              -> Status update flow (Phase 2, day 5)
                -> UI dashboard + creation form (Phase 3, day 1-2)
                  -> Task detail + auto-refresh (Phase 3, day 3-4)
```

The critical dependency is GitHub App setup. If the App is not installed on the org before Phase 2 starts, PR creation is blocked. Phase 1 can proceed without the App (agent spawning works, but no PR creation). The App setup should be initiated in parallel with Phase 1 development.

The poller is the second critical dependency -- all downstream work depends on tasks being picked up. If Klaus is unreachable during development, mock the `submitTask` call to unblock Phase 1 testing.

## Generated Artifacts

- [contracts/mcp-tools.md](contracts/mcp-tools.md) -- pipeline MCP tool interface contracts
- [data-model.md](data-model.md) -- entity definitions and state transitions
- [research.md](research.md) -- research decisions and alternatives
