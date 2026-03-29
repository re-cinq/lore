# Data Model: Task-to-Agent Pipeline

All entities live in a `pipeline` schema in the existing lore database.

## Entities

### PipelineTask

The core entity representing a task that flows through the agent
pipeline. Each task has exactly one target repo and spawns at most
one agent at a time.

| Field | Type | Constraints |
|-------|------|-------------|
| id | UUID | PK, auto-generated |
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
| created_by | TEXT | NOT NULL ('ui', 'mcp', or agent ID) |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() |

**Indexes:**
- btree on `(status)` -- poller queries filter by status
- btree on `(created_at)` -- dashboard ordering
- btree on `(agent_id)` -- agent lookups

**Status values:** `pending`, `queued`, `running`, `pr-created`,
`review`, `merged`, `failed`, `cancelled`

### TaskEvent

An append-only log of state transitions for a pipeline task. Every
status change is recorded with a timestamp and optional metadata.
This table is the audit trail for the entire task lifecycle.

| Field | Type | Constraints |
|-------|------|-------------|
| id | UUID | PK, auto-generated |
| task_id | UUID | FK to PipelineTask, NOT NULL |
| from_status | TEXT | Nullable (null for initial creation event) |
| to_status | TEXT | NOT NULL |
| metadata | JSONB | Nullable (agent logs, PR URL, error details) |
| created_at | TIMESTAMPTZ | DEFAULT NOW() |

**Indexes:**
- btree on `(task_id, created_at)` -- event timeline queries

### TaskTypeConfig (YAML, not a DB table)

Task type definitions loaded from `scripts/task-types.yaml` on MCP
server startup. Not stored in the database -- version-controlled in
the context repo so changes go through PR review.

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

**Fields per task type:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| prompt_template | string | Yes | Prompt prefix sent to the agent |
| target_repo | string | No | Default target repo for this type (override per task) |
| timeout_minutes | number | Yes | Agent timeout before auto-fail |
| review_required | boolean | Yes | Whether to spawn a review agent after PR creation |

## Entity Relationships

```
PipelineTask 1──→N TaskEvent
  Each task has an ordered sequence of state transition events.

PipelineTask ──→ TaskTypeConfig
  Via task_type field, resolved from YAML at runtime.
```

- **PipelineTask 1 to N TaskEvent** -- Every status change on a
  task creates a new TaskEvent row. The `task_id` FK on TaskEvent
  points back to the PipelineTask. Events are append-only and never
  updated or deleted.

- **PipelineTask to TaskTypeConfig** -- The `task_type` field on
  PipelineTask references a key in the YAML config. This is a
  logical reference (not a FK) resolved at runtime. If the task type
  is not found in config, the `general` default is used.

## State Transitions

```
pending ──→ queued      (poller picks up task, slot available)
queued  ──→ running     (Klaus accepts the agent submission)
running ──→ pr-created  (agent completes, PR opened)
running ──→ failed      (agent error or timeout)
pr-created ──→ review   (review agent triggered, if review_required)
pr-created ──→ merged   (PR merged, no review required)
review  ──→ running     (revision triggered, review_iteration < 2)
review  ──→ merged      (PR approved and merged)
review  ──→ failed      (max review iterations exceeded, escalate to human)
pending ──→ cancelled   (user cancels before agent starts)
queued  ──→ cancelled   (user cancels while waiting for Klaus)
running ──→ cancelled   (user cancels, running agent killed)
```

### Transition Details

- **pending to queued**: The poller finds a pending task and a
  concurrency slot is available (running + queued < max agents).
  The poller claims the task with `SELECT ... FOR UPDATE SKIP
  LOCKED` to prevent double-pickup.

- **queued to running**: The Klaus HTTP endpoint accepts the task
  submission and returns a Klaus task ID. The pipeline stores this
  as `agent_id` on the task.

- **running to pr-created**: The poller detects that the Klaus agent
  has completed successfully. The pipeline creates a branch and PR
  on the target repo via GitHub API. The `pr_url` and `pr_number`
  are set on the task.

- **running to failed**: The Klaus agent crashes, times out
  (exceeds `timeout_minutes` from task type config), or returns an
  error. The `failure_reason` is set from the Klaus error response
  or a timeout message.

- **pr-created to review**: If the task type has
  `review_required: true`, a review agent is spawned. The review
  agent reads the PR diff and relevant Lore context.

- **pr-created to merged**: If the task type has
  `review_required: false`, the PR goes directly to human review.
  Once merged (detected via GitHub polling or webhook), the task
  transitions to `merged`.

- **review to running**: The review agent requests changes and
  `review_iteration < 2`. The implementation agent is re-triggered
  with review feedback appended to the context bundle.

- **review to merged**: The review agent approves, and a human
  subsequently merges the PR.

- **review to failed**: The review agent requests changes but
  `review_iteration >= 2`. The task is escalated to human
  intervention. A comment is posted on the PR with full context.

- **cancelled**: A user calls `cancel_task`. If the task was
  `running`, the pipeline attempts to cancel the Klaus agent
  (best-effort). The task transitions to `cancelled` regardless
  of whether the agent cancellation succeeds.

## DDL

```sql
CREATE SCHEMA IF NOT EXISTS pipeline;

CREATE TABLE pipeline.tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description     TEXT NOT NULL,
  task_type       TEXT NOT NULL DEFAULT 'general',
  status          TEXT NOT NULL DEFAULT 'pending',
  target_repo     TEXT NOT NULL,
  target_branch   TEXT,
  agent_id        TEXT,
  pr_url          TEXT,
  pr_number       INTEGER,
  review_iteration INTEGER NOT NULL DEFAULT 0,
  context_bundle  JSONB,
  failure_reason  TEXT,
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_status ON pipeline.tasks (status);
CREATE INDEX idx_tasks_created_at ON pipeline.tasks (created_at);
CREATE INDEX idx_tasks_agent_id ON pipeline.tasks (agent_id);

CREATE TABLE pipeline.task_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES pipeline.tasks(id),
  from_status TEXT,
  to_status   TEXT NOT NULL,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_events_task_created
  ON pipeline.task_events (task_id, created_at);

-- Trigger to update tasks.updated_at on status change
CREATE OR REPLACE FUNCTION pipeline.update_task_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE pipeline.tasks
  SET updated_at = now(), status = NEW.to_status
  WHERE id = NEW.task_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_task_event_update
  AFTER INSERT ON pipeline.task_events
  FOR EACH ROW
  EXECUTE FUNCTION pipeline.update_task_timestamp();
```
