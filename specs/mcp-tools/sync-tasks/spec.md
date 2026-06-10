# Feature Specification: sync_tasks MCP Tool

| Field   | Value                                  |
|---------|----------------------------------------|
| Feature | sync_tasks MCP Tool                    |
| Status  | **Draft**                              |
| Created | 2026-06-10                             |
| Owner   | Platform Engineering                   |
| Tool    | `sync_tasks`                           |
| Module  | Pipeline (`features/pipeline/tasks.ts`)|
| Scope   | shared                                 |

## Problem Statement

A speckit `tasks.md` is a human-authored checklist of spec-tasks with phases,
parallelization markers (`[P]`), explicit dependencies (`[DEPENDS ON: …]`), and
optional file-path suffixes. To track and coordinate that work — including
multi-agent claiming and dependency-gated readiness — those checkboxes must
become rows in `pipeline.tasks` (`task_type = 'spec-task'`). `sync_tasks` parses
the markdown and upserts each task idempotently so re-running after edits
updates in place instead of duplicating.

## Interface

Registered via `server.tool` ([registration](../../../mcp-server/src/mcp/tools/pipeline-tools.ts#L231)).

- **name**: `sync_tasks`
- **description** (verbatim): *"Parse a tasks.md file and sync spec-tasks into
  the pipeline. Handles dependencies and parallelization markers."*

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `tasks_markdown` | string | yes | — | Full markdown text of `tasks.md`. |
| `repo` | string | no | — | `owner/repo`. Auto-detected from the git remote when omitted. |
| `spec_slug` | string | yes | — | Feature slug (e.g. `auth-refactor`); groups tasks within the repo. |

## Behavior

1. Resolve `repo || detectCurrentRepo()`. If neither yields a repo, return
   `"Could not detect repo. Specify repo parameter."`.
2. `getPool()`. If null, return `"sync_tasks requires PostgreSQL (LORE_DB_HOST not set)."`.
3. `parseTasks(tasks_markdown)` (from `@re-cinq/lore-shared`). If the parse
   yields zero tasks, return `"No tasks found in the provided markdown."`.
4. Delegate to `syncTasksToDb(pool, resolvedRepo, spec_slug, parsed)`
   ([handler](../../../mcp-server/src/features/pipeline/tasks.ts#L20)). For each parsed task it:
   1. Builds `title = "{specTaskId}: {description}"` and a `metadata` object
      (`spec_task_id`, `depends_on`, `spec_slug`, `parallelizable`, `phase`,
      `file_path`); `status = 'completed'` if the checkbox was ticked, else `'pending'`.
   2. `SELECT id, status FROM pipeline.tasks WHERE target_repo = $1 AND task_type = 'spec-task' AND context_bundle->>'spec_task_id' = $2 AND context_bundle->>'spec_slug' = $3`.
   3. If a row exists → `UPDATE pipeline.tasks SET description, context_bundle, status, updated_at = now() WHERE id = $4` (does **not** increment `created`).
   4. If no row exists → `INSERT INTO pipeline.tasks (…, created_by = 'sync_tasks')`, adding `task_group_id` when a group id is supplied; increments `created`.
   5. Returns `{ synced: tasks.length, created }`.
5. Return the summary `"Synced {synced} tasks ({created} new) for {repo} / {spec_slug}."`.
6. Any thrown error → `"Error syncing tasks: {message}"`.

## Output

A single MCP text content block: the synced/created summary, or one of the
guard messages, or the error message. Never throws.

## Dependencies & side effects

- `detectCurrentRepo()`, `getPool()`, `parseTasks` (shared), `syncTasksToDb`.
- DB: reads + upserts `pipeline.tasks` (`task_type = 'spec-task'`).
- No env vars beyond the DB pool's.

## Acceptance Criteria

A task with no matching existing row is inserted and counted as created. ([validated by `inserts a new task and counts it as created`](../../../mcp-server/src/features/pipeline/tasks-db.test.ts#L25))

A task that already exists is updated in place and not counted as created. ([validated by `updates an existing task without counting it as created`](../../../mcp-server/src/features/pipeline/tasks-db.test.ts#L41))

A ticked checkbox is persisted with status `completed`. ([validated by `persists completed tasks with status completed`](../../../mcp-server/src/features/pipeline/tasks-db.test.ts#L56))

A supplied task-group id is threaded into the grouped insert statement. ([validated by `threads task_group_id into the grouped insert`](../../../mcp-server/src/features/pipeline/tasks-db.test.ts#L70))

Across a mixed batch only the previously-unseen tasks count toward `created`. ([validated by `counts only new tasks as created across a mixed batch`](../../../mcp-server/src/features/pipeline/tasks-db.test.ts#L89))

The markdown is parsed into structured tasks with id, description, completion, parallel and dependency markers. ([validated by `parses basic tasks`](../../../mcp-server/src/features/pipeline/tasks.test.ts#L5))

The repo-detection, empty-parse, and no-pool guard branches plus the summary
framing run only inside the tool handler. *(untested: the handler wraps
`detectCurrentRepo`/`getPool` with no unit seam; the parse and DB layers it
delegates to are covered above.)*

## Out of Scope

- The `tasks.md` grammar (phases, `[P]`, `[DEPENDS ON:]`, file paths) — owned by `parseTasks` in `@re-cinq/lore-shared`.
- Readiness/dependency evaluation — see [`ready_tasks`](../ready-tasks/spec.md).
- Phase-dependency inference (`inferPhaseDependencies`).
