# Feature Specification: lore_sync_tasks MCP Tool

| Field   | Value                                  |
|---------|----------------------------------------|
| Feature | lore_sync_tasks MCP Tool                    |
| Status  | Draft                                  |
| Created | 2026-06-10                             |
| Owner   | Platform Engineering                   |
| Tool    | `lore_sync_tasks`                           |
| Module  | Pipeline (`features/pipeline/tasks.ts`)|
| Scope   | shared                                 |

`lore_sync_tasks` parses a speckit tasks.md and idempotently upserts each checklist item as a spec-task row, so re-running after edits updates rows in place instead of duplicating them.

## Problem Statement

A speckit `tasks.md` is a human-authored checklist of spec-tasks with phases,
parallelization markers (`[P]`), explicit dependencies (`[DEPENDS ON: …]`), and
optional file-path suffixes. To track and coordinate that work — including
multi-agent claiming and dependency-gated readiness — those checkboxes must
become rows in `pipeline.tasks` (`task_type = 'spec-task'`). `lore_sync_tasks` parses
the markdown and upserts each task idempotently so re-running after edits
updates in place instead of duplicating.

## Interface

Registered via `server.tool` ([registration](apps/mcp-server/src/mcp/tools/pipeline-tools.ts#L231)).

- **name**: `lore_sync_tasks`
- **description** (verbatim):

```text
Parses a speckit tasks.md and idempotently upserts each checklist item as a spec-task row; returns a 'Synced N tasks (M new)' summary. Run once per spec before any claiming — this is the start of spec-driven multi-agent work. This tool does NOT claim, run, or evaluate readiness. (DB-only) After syncing: lore_ready_tasks to find workable items; lore_claim_task to lock one; lore_complete_task to finish it.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `tasks_markdown` | string | yes | — | Full markdown text of the tasks.md document (not a path). Parsed for phases, [P] parallel markers, [DEPENDS ON: …] deps, and file-path suffixes. |
| `repo` | string | no | — | `owner/repo`. Auto-detected from git remote when omitted. |
| `spec_slug` | string | yes | — | Feature slug grouping these spec-tasks within the repo. |

## Behavior

1. Resolve `repo || detectCurrentRepo()`. If neither yields a repo, return
   `"Could not detect repo. Specify repo parameter."`.
2. `getPool()`. If null, return `"lore_sync_tasks requires PostgreSQL (LORE_DB_HOST not set)."`.
3. `parseTasks(tasks_markdown)` (from `@re-cinq/lore-shared`). If the parse
   yields zero tasks, return `"No tasks found in the provided markdown."`.
4. Delegate to `syncTasksToDb(pool, resolvedRepo, spec_slug, parsed)`
   ([handler](../../../apps/mcp-server/src/features/pipeline/tasks.ts#L20)). For each parsed task it:
   1. Builds `title = "{specTaskId}: {description}"` and a `metadata` object
      (`spec_task_id`, `depends_on`, `spec_slug`, `parallelizable`, `phase`,
      `file_path`); `status = 'completed'` if the checkbox was ticked, else `'pending'`.
   2. `SELECT id, status FROM pipeline.tasks WHERE target_repo = $1 AND task_type = 'spec-task' AND context_bundle->>'spec_task_id' = $2 AND context_bundle->>'spec_slug' = $3`.
   3. If a row exists → `UPDATE pipeline.tasks SET description, context_bundle, status, updated_at = now() WHERE id = $4` (does **not** increment `created`).
   4. If no row exists → `INSERT INTO pipeline.tasks (…, created_by = 'lore_sync_tasks')`, adding `task_group_id` when a group id is supplied; increments `created`.
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

A task with no matching existing row is inserted and counted as created. ([validated by `inserts a new task and counts it as created`](apps/mcp-server/src/features/pipeline/tasks-db.test.ts#L25))

A task that already exists is updated in place and not counted as created. ([validated by `tasks-db.test.ts:43`](apps/mcp-server/src/features/pipeline/tasks-db.test.ts#L43))

A ticked checkbox is persisted with status `completed`. ([validated by `tasks-db.test.ts:59`](apps/mcp-server/src/features/pipeline/tasks-db.test.ts#L59))

A supplied task-group id is threaded into the grouped insert statement. ([validated by `tasks-db.test.ts:74`](apps/mcp-server/src/features/pipeline/tasks-db.test.ts#L74))

Across a mixed batch only the previously-unseen tasks count toward `created`. ([validated by `tasks-db.test.ts:95`](apps/mcp-server/src/features/pipeline/tasks-db.test.ts#L95))

The markdown is parsed into structured tasks with id, description, completion, parallel and dependency markers. ([validated by `tasks.test.ts:5`](libs/server-core/src/features/pipeline/tasks.test.ts#L5))

The repo-detection, empty-parse, and no-pool guard branches plus the summary
framing run only inside the tool handler. *(untested: the handler wraps
`detectCurrentRepo`/`getPool` with no unit seam; the parse and DB layers it
delegates to are covered above.)*

## Out of Scope

- The `tasks.md` grammar (phases, `[P]`, `[DEPENDS ON:]`, file paths) — owned by `parseTasks` in `@re-cinq/lore-shared`.
- Readiness/dependency evaluation — see [`lore_ready_tasks`](../ready-tasks/spec.md).
- Phase-dependency inference (`inferPhaseDependencies`).
