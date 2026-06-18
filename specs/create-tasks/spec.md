# Feature Specification: Create Tasks from Planned Features

| Field          | Value                                        |
|----------------|----------------------------------------------|
| Feature        | Create Tasks from Planned Features           |
| Branch         | create-tasks                                 |
| Status         | In Progress                                  |
| Created        | 2026-06-18                                   |
| Owner          | Platform Engineering                         |

## Problem Statement

The feature-planning workflow takes an author from a one-line prompt to a
finalized `spec.md` PR — but the journey ends there. Once the spec PR is
merged there is no automated bridge back into the implementation pipeline:
engineers manually read the spec and create pipeline tasks, or re-run the
legacy `feature-request` path which generates its own one-shot spec rather
than reading the existing one. The feature record holds no reference to the
tasks that implement it, so it is impossible to tell from the feature whether
any work is in flight or when the feature is fully implemented.

The result: the spec that was authored collaboratively and reviewed carefully
ends up disconnected from the code that realizes it.

## Vision

A **Create tasks** action on a finalized feature kicks a `feature-create-tasks`
agent that reads `specs/<slug>/spec.md` and returns a structured task list —
one `implementation` task per major work item derived from the spec's functional
requirements. The author previews the suggested tasks, trims or adjusts, and
confirms. Confirmed tasks are created in the pipeline grouped under the feature's
`task_group_id`. The feature detail tracks each task's status inline. When all
tasks in the group merge, the feature auto-transitions to `implemented` and a
summary episode is written — the spec-to-implementation loop is closed.

## Integration & Relationships

- **Smart Feature Planning (`specs/7-feature-planning`).** This feature is the
  direct continuation of the feature lifecycle defined there. It picks up at
  `pr-open` and advances toward `implemented`. The `lore.features` table,
  `FeaturesPort`, and the feature detail page are extended in place.
- **Task-to-Agent Pipeline (`specs/3-task-agent-pipeline`).** Implementation
  tasks are created via the existing `createTask` helper with `taskGroupId`;
  the agent worker dispatches them as `implementation` tasks. No new
  orchestration — this feature is a consumer of the existing pipeline.
- **Dark Factory (`specs/6-dark-factory`).** `feature-create-tasks` is a
  doc-tier task type (reads spec, emits JSON, no repo mutation in its own run),
  so it is gated at `docs` trust like `feature-planning`. The confirmed
  `implementation` tasks respect the repo's `implementation`-tier trust check
  at creation time.
- **Context assembly (`specs/context-assembly`).** The create-tasks round
  hydrates spec content through the same `/api/context` path used by every
  other pipeline step.
- **Task groups (CLAUDE.md).** `lore_list_task_group` and the task-group summary
  episode are already wired. This feature makes first-party use of them from
  the feature lifecycle: `lore.features.task_group_id` is the join key.

## User Personas

### Feature Author (Product Owner / PM)

Has finalized a feature and wants implementation to start. Wants a scoped,
reviewable list of tasks before committing to them. Does not write code or
create tasks manually.

### Developer

Receives the generated implementation tasks as pipeline work items. Reviews
the spec and the tasks; may adjust the split or add more via the pipeline UI.
Wants the feature to reflect "done" automatically when all PRs merge.

### Platform Engineer

Configures trust levels and monitors the pipeline. Wants assurance that the
`feature-create-tasks` agent never creates tasks that bypass the repo's trust
gate.

## User Scenarios & Acceptance Criteria

### Scenario 1: Create tasks from a finalized feature spec

**Actor:** Feature Author

**Flow:**
1. Author opens the feature detail page; the feature is in `pr-open` status.
2. Author clicks **Create implementation tasks**.
3. The platform kicks a `feature-create-tasks` task; the feature transitions
   to `tasks-creating`.
4. The agent reads `specs/<slug>/spec.md` (fetched from the repo) and returns
   a `TaskList` JSON: an ordered list of task descriptions and target repos.
5. The page renders the suggested tasks as a preview list.
6. Author confirms (optionally trimming or renaming tasks).
7. Confirmed tasks are created in the pipeline with the feature's
   `task_group_id`; the feature transitions to `tasks-ready`.
8. The feature detail shows each task with its pipeline status.

**Acceptance Criteria:**
- "Create tasks" is only shown when the feature is in a post-finalize status (`pr-open` or `tasks-ready`). ([validated by featureCanCreateTasks returns false for draft/planning statuses](../../libs/shared/src/project/features/task-list.test.ts#L12))
- The `feature-create-tasks` agent produces a `TaskList` that validates against the shared schema. ([validated by parseTaskList accepts a valid payload](../../libs/shared/src/project/features/task-list.test.ts#L28))
- The `feature-create-tasks` round runs **in-process** (same ADR-027 rationale as `feature-planning`): no repo mutation, no pod, just LLM→JSON. ([validated by handleFeaturesRoute kicks create-tasks in-process not as a Job pod](../../apps/mcp-server/src/api/routes/features.test.ts#L180))
- The feature transitions to `tasks-creating` when the create-tasks round starts and to `tasks-ready` when confirmed tasks are created. ([validated by handleFeaturesRoute transitions to tasks-ready on confirm](../../apps/mcp-server/src/api/routes/features.test.ts#L199))

### Scenario 2: Review and trim the suggested task list before confirming

**Actor:** Feature Author

**Flow:**
1. The suggested task list shows 6 tasks derived from the spec's FRs.
2. Author removes 2 tasks deemed out-of-scope for this iteration.
3. Author renames one task for clarity.
4. Author confirms the trimmed list of 4 tasks.
5. Exactly 4 pipeline tasks are created, all grouped under the feature.

**Acceptance Criteria:**
- The preview allows removing individual suggested tasks and editing their descriptions before confirmation.
- Only the confirmed subset is submitted to the pipeline; removed tasks are never created. ([validated by feature-api confirm posts only the confirmed task subset](../../apps/web-ui/src/lib/feature-api.test.ts#L68))
- An empty confirm (all tasks removed) is rejected client-side before submission and server-side as a 400. ([validated by handleFeaturesRoute rejects an empty task-list confirm with 400](../../apps/mcp-server/src/api/routes/features.test.ts#L215))

### Scenario 3: Feature auto-transitions to `implemented` when all tasks merge

**Actor:** System

**Flow:**
1. All `implementation` pipeline tasks in the feature's task group have their
   PRs merged.
2. The periodic completion check finds no pending tasks in the group.
3. The feature transitions from `tasks-ready` to `implemented`; `implemented_at`
   is stamped.
4. A summary episode is written recording the feature as shipped.

**Acceptance Criteria:**
- When all tasks in a feature's `task_group_id` reach a terminal merged status, the feature's status is updated to `implemented`. ([validated by advanceFeatureOnGroupComplete transitions to implemented](../../libs/shared/src/project/features/features-pg.test.ts#L165))
- The feature detail page shows `implemented` status with the merge date.
- A task closed without merge surfaces as a warning badge on the feature detail but does not block the `implemented` transition for the remaining tasks. ([validated by advanceFeatureOnGroupComplete marks implemented when non-merged tasks remain](../../libs/shared/src/project/features/features-pg.test.ts#L178))

## Functional Requirements

### FR-1: "Create Tasks" Action on Feature Detail

The system MUST expose a create-tasks trigger on finalized features.

- FR-1.1: The feature detail page shows a **Create implementation tasks** button when the feature is in `pr-open` or `tasks-ready` status.
- FR-1.2: The button is absent (not disabled) for all other statuses: `draft`, `planning`, `awaiting-input`, `spec-ready`, `tasks-creating`, `implemented`, `split`.
- FR-1.3: Clicking the button kicks a `feature-create-tasks` round and transitions the feature to `tasks-creating`; the button is replaced by a polling progress indicator until the preview is ready. ([validated by handleFeaturesRoute kicks create-tasks in-process not as a Job pod](../../apps/mcp-server/src/api/routes/features.test.ts#L180))
- FR-1.4: A concurrent create-tasks round is rejected with 409 while one is already in flight for the same feature. ([validated by handleFeaturesRoute rejects a concurrent create-tasks round with 409](../../apps/mcp-server/src/api/routes/features.test.ts#L228))

### FR-2: `feature-create-tasks` Agent

The system MUST derive an implementation task list from the spec without any repo mutation.

- FR-2.1: `feature-create-tasks` runs **in-process** in the worker (ADR-027): a single LLM→JSON call that reads the assembled spec content and returns a `TaskList`. No Job pod, no commit, no branch.
- FR-2.2: The agent's prompt and model resolve from the `feature-create-tasks` agent definition (org default + per-repo override), not a hardcoded constant.
- FR-2.3: The round receives the feature id and spec path; the hydrated context includes the assembled spec markdown at the head of the prompt so the agent sees the full spec before the project context. ([validated by composeCreateTasksPrompt embeds spec markdown before project context](../../libs/shared/src/project/features/task-list.test.ts#L44))
- FR-2.4: The round bills org credentials (`ANTHROPIC_API_KEY`); personal auth requires explicit `LORE_STATION_ALLOW_PERSONAL_AUTH` opt-in, never silent fallback.

### FR-3: `TaskList` Contract

The system MUST validate the agent's output before surfacing it.

- FR-3.1: A `TaskList` is an ordered array of `TaskProposal` objects, each carrying a `description` (string, max 2 000 chars), a `task_type` (default `implementation`), and an optional `target_repo`. ([validated by parseTaskList accepts a valid payload](../../libs/shared/src/project/features/task-list.test.ts#L28))
- FR-3.2: The result is validated against the shared Zod schema (`taskListSchema`, `parseTaskList`); an invalid result marks the round failed and restores the feature to its prior status.
- FR-3.3: A `TaskList` with zero proposals or more than 20 proposals is treated as invalid. ([validated by parseTaskList rejects an empty list and an over-limit list](../../libs/shared/src/project/features/task-list.test.ts#L55))

### FR-4: Task Creation & Grouping

The system MUST create confirmed tasks under the feature's task group.

- FR-4.1: On confirmation, the confirmed `TaskProposal` items are created via `createTask` with the feature's `task_group_id`; the feature is updated with the `task_group_id` when the first task is created (if not already set). ([validated by handleFeaturesRoute creates tasks under the feature's task group](../../apps/mcp-server/src/api/routes/features.test.ts#L199))
- FR-4.2: Each confirmed task's `target_repo` defaults to the feature's repo when the agent leaves it unset.
- FR-4.3: Task creation respects the repo's trust level: `implementation` tasks require `implementation` or `full` trust; a repo at `docs` or `tests` tier returns 403 rather than silently creating the tasks.
- FR-4.4: If any single task creation fails mid-batch, the successfully created tasks are not rolled back; the feature records which tasks were created via the stored `task_group_id` so a retry can skip already-created items.

### FR-5: Lifecycle Completion

The system MUST close the feature lifecycle when all implementation work merges.

- FR-5.1: A periodic check (≤ 2-minute interval, co-located with the existing lease reaper) queries `lore.features` for rows in `tasks-ready` whose `task_group_id` has no pending tasks in `pipeline.tasks`. ([validated by advanceFeatureOnGroupComplete queries the group before transitioning](../../libs/shared/src/project/features/features-pg.test.ts#L165))
- FR-5.2: When all tasks in the group reach a terminal status, the feature transitions to `implemented` and `implemented_at` is stamped.
- FR-5.3: A summary episode is written via `lore_write_episode` capturing the feature title, spec path, task count, and the `implemented_at` timestamp.
- FR-5.4: A task closed without merge (rejected PR) surfaces as a warning badge on the feature detail but does not block the `implemented` transition for the remaining tasks. ([validated by advanceFeatureOnGroupComplete marks implemented when non-merged tasks remain](../../libs/shared/src/project/features/features-pg.test.ts#L178))

### FR-6: Persistence — Migration `0020_feature_create_tasks.sql`

The system MUST extend the feature model without breaking existing rows.

- FR-6.1: Migration `0020` adds `task_group_id uuid`, `tasks_created_at timestamptz`, and `implemented_at timestamptz` to `lore.features`, and extends the `status` CHECK constraint to include `tasks-creating` and `tasks-ready`.
- FR-6.2: The migration is single-transaction, idempotent (all DDL guarded with `IF NOT EXISTS` / `DO $$ BEGIN … EXCEPTION WHEN duplicate_column THEN NULL; END $$`), and adds a partial index on `(task_group_id) WHERE task_group_id IS NOT NULL`.
- FR-6.3: A CI guard applies all migrations including `0020` against an ephemeral Postgres and re-applies `0020` to verify idempotency, failing the build on any error.

### FR-7: Project Port Extension

The system MUST expose create-tasks operations through the existing `features` port.

- FR-7.1: `FeaturesPort` gains four new methods: `setTaskGroup(featureId, taskGroupId)`, `setTasksCreated(featureId)`, `setImplemented(featureId)`, `findTasksReady()` (returns features with `tasks-ready` status and a non-null `task_group_id`). ([validated by PgFeatures.setTaskGroup updates task_group_id and tasks_created_at](../../libs/shared/src/project/features/features-pg.test.ts#L175))
- FR-7.2: The `Features` facade exposes `createTasksFor(featureId, proposals[])` which orchestrates validate → `createTask` loop → `setTasksCreated`. ([validated by the Features facade creates tasks and transitions status in one call](../../libs/shared/src/project/features/features.test.ts#L50))
- FR-7.3: The web UI routes all create-tasks lifecycle writes through the mcp-server API (`POST /features/:id/create-tasks`, `POST /features/:id/create-tasks/confirm`); it reads task status directly from the pipeline view. ([validated by feature-api confirm posts to /features/:id/create-tasks/confirm](../../apps/web-ui/src/lib/feature-api.test.ts#L68))
