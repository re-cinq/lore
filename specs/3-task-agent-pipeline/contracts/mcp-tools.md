# MCP Tool Contracts: Task-to-Agent Pipeline

All tools are registered via `@modelcontextprotocol/sdk` using
`server.tool()` with Zod input schemas. Responses follow the MCP
content format: `{ content: [{ type: 'text', text: string }] }`.

Pipeline tools require PostgreSQL (`LORE_DB_HOST` must be set). If
the database is unavailable, all pipeline tools return an error:
`"Pipeline requires PostgreSQL (LORE_DB_HOST not set)."`.

---

## create_pipeline_task

Create a new task in the pipeline. The task enters `pending` status
and will be picked up by the poller within 10 seconds (subject to
concurrency limits).

**Input:**
```typescript
{
  description: z.string()
    .describe('Task description. What should the agent do? Be specific -- this is the primary instruction the agent receives.'),
  task_type: z.string().default('general')
    .describe('Task type from task-types.yaml (e.g., "general", "runbook", "implementation", "gap-fill"). Determines prompt template, timeout, and review policy.'),
  target_repo: z.string().optional()
    .describe('Target GitHub repository in "owner/repo" format (e.g., "re-cinq/lore"). If omitted, uses the default from task type config.'),
  context: z.object({
    beads_task_id: z.string().optional(),
    spec_file: z.boolean().optional(),
    branch: z.string().optional(),
    seed_query: z.string().optional(),
  }).optional()
    .describe('Additional context to pass to the agent. Beads task ID, spec file flag, branch name, or seed query for context retrieval.')
}
```

**Response:**
```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "task_type": "runbook",
  "target_repo": "re-cinq/lore",
  "created_at": "2026-03-29T10:00:00Z"
}
```

**Behavior:**
1. Validate `task_type` against loaded config. If unknown, fall back
   to `general`.
2. Resolve `target_repo`: use input value if provided, else use task
   type's `target_repo` from config, else return error.
3. Build initial `context_bundle` JSONB from `context` input (if
   provided) using `buildContextBundle()` from `context-bundle.ts`.
4. Insert into `pipeline.tasks` with `status = 'pending'` and
   `created_by = 'mcp'`.
5. Insert initial TaskEvent: `from_status = null`,
   `to_status = 'pending'`.
6. Return the task ID, status, resolved type, and target repo.

**Error handling:**
- Missing `target_repo` and no default in task type config: return
  error `"target_repo is required for task type '{type}' (no default configured)"`.
- Description empty or whitespace-only: return error
  `"description is required and cannot be empty"`.
- Database unavailable: return error
  `"Pipeline requires PostgreSQL (LORE_DB_HOST not set)."`.

---

## get_pipeline_status

Retrieve the current status of a pipeline task, including its full
event history.

**Input:**
```typescript
{
  task_id: z.string()
    .describe('UUID of the pipeline task.')
}
```

**Response:**
```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "description": "Write a runbook for the auth retry flow",
  "task_type": "runbook",
  "status": "pr-created",
  "target_repo": "re-cinq/lore",
  "target_branch": "agent/550e8400/auth-retry-runbook",
  "agent_id": "klaus-pod-abc123",
  "pr_url": "https://github.com/re-cinq/lore/pull/42",
  "pr_number": 42,
  "review_iteration": 0,
  "created_by": "mcp",
  "created_at": "2026-03-29T10:00:00Z",
  "updated_at": "2026-03-29T10:05:30Z",
  "failure_reason": null,
  "events": [
    {
      "from_status": null,
      "to_status": "pending",
      "metadata": null,
      "created_at": "2026-03-29T10:00:00Z"
    },
    {
      "from_status": "pending",
      "to_status": "queued",
      "metadata": null,
      "created_at": "2026-03-29T10:00:10Z"
    },
    {
      "from_status": "queued",
      "to_status": "running",
      "metadata": { "agent_id": "klaus-pod-abc123" },
      "created_at": "2026-03-29T10:00:12Z"
    },
    {
      "from_status": "running",
      "to_status": "pr-created",
      "metadata": { "pr_url": "https://github.com/re-cinq/lore/pull/42" },
      "created_at": "2026-03-29T10:05:30Z"
    }
  ]
}
```

**Behavior:**
1. Query `pipeline.tasks WHERE id = task_id`.
2. Query `pipeline.task_events WHERE task_id = task_id ORDER BY
   created_at ASC`.
3. Return the task row with all events attached.

**Error handling:**
- Task not found: return error `"task not found: {task_id}"`.
- Invalid UUID format: return error
  `"invalid task_id format: {task_id}"`.

---

## list_pipeline_tasks

List pipeline tasks with optional filtering by status. Returns
tasks ordered by creation time, newest first.

**Input:**
```typescript
{
  status: z.string().optional()
    .describe('Filter by status (e.g., "pending", "running", "pr-created", "failed"). Omit to return all tasks.'),
  limit: z.number().default(20)
    .describe('Maximum number of tasks to return. Default 20, max 100.')
}
```

**Response:**
```json
{
  "tasks": [
    {
      "task_id": "550e8400-e29b-41d4-a716-446655440000",
      "description": "Write a runbook for the auth retry flow",
      "task_type": "runbook",
      "status": "pr-created",
      "target_repo": "re-cinq/lore",
      "agent_id": "klaus-pod-abc123",
      "pr_url": "https://github.com/re-cinq/lore/pull/42",
      "created_at": "2026-03-29T10:00:00Z",
      "updated_at": "2026-03-29T10:05:30Z"
    },
    {
      "task_id": "660f9500-f39c-52e5-b827-557766550000",
      "description": "Implement user notification preferences API",
      "task_type": "implementation",
      "status": "running",
      "target_repo": "re-cinq/notification-service",
      "agent_id": "klaus-pod-def456",
      "pr_url": null,
      "created_at": "2026-03-29T09:45:00Z",
      "updated_at": "2026-03-29T09:45:15Z"
    }
  ],
  "total": 47
}
```

**Behavior:**
1. Build query: `SELECT * FROM pipeline.tasks`.
2. If `status` is provided, add `WHERE status = $1`.
3. Add `ORDER BY created_at DESC LIMIT $limit`.
4. Count total matching tasks for pagination.
5. Return task list with summary fields (no events, no
   context_bundle -- use `get_pipeline_status` for full details).

**Error handling:**
- Invalid status value: return error
  `"invalid status: {status}. Valid values: pending, queued, running, pr-created, review, merged, failed, cancelled"`.
- `limit` exceeds 100: clamp to 100 silently.
- No tasks found: return `{ tasks: [], total: 0 }` (not an error).

---

## cancel_task

Cancel a pipeline task. If the task has a running agent, the
pipeline attempts to cancel it on Klaus (best-effort). The task
transitions to `cancelled` regardless of whether the agent
cancellation succeeds.

**Input:**
```typescript
{
  task_id: z.string()
    .describe('UUID of the pipeline task to cancel.')
}
```

**Response:**
```json
{
  "task_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "cancelled",
  "previous_status": "running",
  "agent_cancelled": true
}
```

**Behavior:**
1. Query `pipeline.tasks WHERE id = task_id`.
2. If task is in a terminal state (`merged`, `failed`, `cancelled`),
   return error -- cannot cancel a completed task.
3. If task is `running` and has an `agent_id`:
   a. Attempt to cancel the agent on Klaus (best-effort HTTP call).
   b. Set `agent_cancelled` in response based on whether Klaus
      cancellation succeeded.
4. Insert TaskEvent: `from_status = current_status`,
   `to_status = 'cancelled'`.
5. Update task `status = 'cancelled'`.
6. Return confirmation with previous status and cancellation result.

**Error handling:**
- Task not found: return error `"task not found: {task_id}"`.
- Task already in terminal state: return error
  `"cannot cancel task in '{status}' state"`.
- Klaus cancellation fails: log warning, set
  `agent_cancelled = false` in response. The task is still marked
  as `cancelled` -- the Klaus agent will time out on its own.
- Invalid UUID format: return error
  `"invalid task_id format: {task_id}"`.
