# Feature Specification: lore_sync_tasks MCP Tool

| Field   | Value                                  |
|---------|----------------------------------------|
| Feature | lore_sync_tasks MCP Tool                    |
| Status  | In Progress                            |
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
2. `POST /api/spec-tasks/sync` with `{repo, spec_slug, tasks_markdown}` via
   `proxyToApi` — the raw markdown, not a parsed tree, so the `tasks.md` grammar
   has exactly one home ([`POST /api/spec-tasks/sync`](../../api-routes/spec-tasks/spec.md)).
   The MCP adapter holds no pool (ADR-032).
3. Server-side, `parseTasks(tasks_markdown)` runs first; a parse yielding zero
   tasks answers `{parsed: 0, synced: 0, created: 0}` and the tool renders
   `"No tasks found in the provided markdown."`.
4. The route delegates to `syncTasksToDb(pool, repo, spec_slug, parsed)`
   ([handler](../../../libs/server-core/src/features/pipeline/tasks.ts#L24)). For each parsed task it:
   1. Builds `title = "{specTaskId}: {description}"` and a `metadata` object
      (`spec_task_id`, `depends_on`, `spec_slug`, `parallelizable`, `phase`,
      `file_path`); `status = 'completed'` if the checkbox was ticked, else `'pending'`.
   2. `SELECT id, status FROM pipeline.tasks WHERE target_repo = $1 AND task_type = 'spec-task' AND context_bundle->>'spec_task_id' = $2 AND context_bundle->>'spec_slug' = $3`.
   3. If a row exists → `UPDATE pipeline.tasks SET description, context_bundle, status, updated_at = now() WHERE id = $4` (does **not** increment `created`).
   4. If no row exists → `INSERT INTO pipeline.tasks (…, created_by = 'lore_sync_tasks')`, adding `task_group_id` when a group id is supplied; increments `created`.
   5. Returns `{ synced: tasks.length, created }`.
5. Return the summary `"Synced {synced} tasks ({created} new) for {repo} / {spec_slug}."`.
6. **Failure** — `not_configured` → the not-configured text; `denied` → the
   denial text; `unreachable` → the `unreachableError("syncing spec-tasks", detail)` text.

## Output

A single MCP text content block: the synced/created summary, or one of the
guard messages, or the error message. Never throws.

## Dependencies & side effects

- `detectCurrentRepo()` (client-side — the server cannot see the caller's git
  remote), `proxyToApi`, and the shared proxy error helpers.
- Server-side: `parseTasks` (shared) + `syncTasksToDb`, which reads and upserts
  `pipeline.tasks` (`task_type = 'spec-task'`).
- Env: `LORE_API_URL`, `LORE_INGEST_TOKEN`. No database handle.

## Acceptance Criteria

A task with no matching existing row is inserted and counted as created. ([validated by `inserts a new task and counts it as created`](apps/mcp-server/src/features/pipeline/tasks-db.test.ts#L25))

A task that already exists is updated in place and not counted as created. ([validated by `tasks-db.test.ts:43`](apps/mcp-server/src/features/pipeline/tasks-db.test.ts#L43))

A ticked checkbox is persisted with status `completed`. ([validated by `tasks-db.test.ts:59`](apps/mcp-server/src/features/pipeline/tasks-db.test.ts#L59))

A supplied task-group id is threaded into the grouped insert statement. ([validated by `tasks-db.test.ts:74`](apps/mcp-server/src/features/pipeline/tasks-db.test.ts#L74))

Across a mixed batch only the previously-unseen tasks count toward `created`. ([validated by `tasks-db.test.ts:95`](apps/mcp-server/src/features/pipeline/tasks-db.test.ts#L95))

The markdown is parsed into structured tasks with id, description, completion, parallel and dependency markers. ([validated by `tasks.test.ts:5`](libs/server-core/src/features/pipeline/tasks.test.ts#L5))

The raw markdown, repo, and slug are posted to `/api/spec-tasks/sync` and the
counts are rendered as the synced/created summary. ([validated by `lore_sync_tasks posts the raw markdown and summarizes the counts`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L327))

Markdown that parses to no tasks renders the no-tasks message instead of a
zero-count summary. ([validated by `lore_sync_tasks reports markdown with no tasks`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L349))

An unconfigured API yields the not-configured message rather than a PostgreSQL
message. ([validated by `every proxied pipeline tool reports a missing API configuration`](apps/mcp-server/src/mcp/tools/pipeline-tools.test.ts#L440))

## Out of Scope

- The `tasks.md` grammar (phases, `[P]`, `[DEPENDS ON:]`, file paths) — owned by `parseTasks` in `@re-cinq/lore-shared`.
- Readiness/dependency evaluation — see [`lore_ready_tasks`](../ready-tasks/spec.md).
- Phase-dependency inference (`inferPhaseDependencies`).
