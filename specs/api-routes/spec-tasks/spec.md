# Feature Specification: /api/spec-tasks/* (the spec-task DAG)

| Field      | Value                                                            |
|------------|------------------------------------------------------------------|
| Feature    | Spec-task DAG HTTP routes                                        |
| Status     | In Progress                                                      |
| Created    | 2026-08-08                                                       |
| Owner      | Platform Engineering                                             |
| Routes     | `POST /api/spec-tasks/sync`, `GET /api/spec-tasks/ready`, `POST /api/spec-tasks/claim`, `POST /api/spec-tasks/complete` |
| Auth scope | `task` (writes), `read` (ready)                                   |
| Module     | `lore-api/src/api/routes/spec-tasks/spec-tasks.ts`               |

The four spec-task endpoints carry the sync → ready → claim → complete loop that turns a speckit `tasks.md` into a dependency-ordered work queue several agents can share without stepping on each other.

## Problem Statement

The spec-task tools (`lore_sync_tasks`, `lore_ready_tasks`, `lore_claim_task`,
`lore_complete_task`) all ran their queue mechanics through a local pg pool. The
MCP adapter has held no pool since ADR-032, so all four answered "requires
PostgreSQL (LORE_DB_HOST not set)" — the whole spec-driven multi-agent loop was
unreachable from a developer's machine. These routes put the mechanics where the
database is.

## Interface

### `POST /api/spec-tasks/sync` — scope `task`

Body `{ repo: "owner/name", spec_slug: string, tasks_markdown: string }`.
The **raw markdown** is posted, not a parsed tree, so the `tasks.md` grammar has
exactly one implementation. Response
`{ parsed, synced, created }`; `parsed: 0` means the markdown held no tasks and
nothing was written.

### `GET /api/spec-tasks/ready` — scope `read`

Query `?repo=owner/name`. Response `{ tasks: [...] }` — the pending spec-tasks
whose every dependency is `completed`/`merged`.

### `POST /api/spec-tasks/claim` — scope `task`

Body `{ task_id, agent_id }`. The claiming agent id is resolved on the caller's
machine and passed in. Response `{ claimed, task_id, agent_id }`.

### `POST /api/spec-tasks/complete` — scope `task`

Body `{ task_id }`. Response `{ completed, unblocked }`.

Every route answers 400 on a schema violation, 503
`{ error: "database unavailable" }` on a null pool, and 500 `{ error }` on a
query failure.

## Behavior

1. Each handler gates on the pool first: null → 503, before parsing or querying.
2. **sync** — `parseTasks(tasks_markdown)` runs server-side; an empty parse
   short-circuits to `{ parsed: 0, synced: 0, created: 0 }` **without** touching
   the database. Otherwise `syncTasksToDb(pool, repo, spec_slug, parsed)` upserts
   one `pipeline.tasks` row per checklist item (`task_type = 'spec-task'`) and
   reports how many were newly created.
3. **ready** — `getReadyTasks(pool, repo)` (the shared `PgTaskQueue`
   dependency query).
4. **claim** — `claimTask(pool, task_id, agent_id)`: `SELECT … FOR UPDATE SKIP
   LOCKED` then `UPDATE`, so exactly one agent wins a race; the response reports
   `claimed: false` rather than erroring when the row is already taken.
5. **complete** — `completeTask(pool, task_id)` returns both the completion flag
   and the descriptors of dependents the completion unblocked.
6. `repo` is validated as `owner/name` (`repoFullName`) on both sync and ready.

## Output

The JSON bodies above; no HTML, no redirects, no fan-out to other services.

## Dependencies & side effects

- `parseTasks` / `syncTasksToDb` / `getReadyTasks` / `claimTask` / `completeTask`
  ([module](../../../libs/server-core/src/features/pipeline/tasks.ts#L16)).
- `pipeline.tasks` (read + upsert + status transitions) and
  `pipeline.task_events` (best-effort claim/complete events).

## Acceptance Criteria

Sync parses the markdown and reports parsed, synced, and created counts. ([validated by `parses the markdown and reports parsed, synced and created counts`](apps/lore-api/src/api/routes/spec-tasks/spec-tasks.test.ts#L61))

Sync passes the parsed tasks, repo, and slug to the syncer. ([validated by `passes the parsed tasks, repo and slug to the syncer`](apps/lore-api/src/api/routes/spec-tasks/spec-tasks.test.ts#L72))

Markdown with no tasks reports `parsed: 0` and never touches the database. ([validated by `reports parsed:0 without syncing when the markdown has no tasks`](apps/lore-api/src/api/routes/spec-tasks/spec-tasks.test.ts#L86))

A repo that is not `owner/name` is rejected with 400. ([validated by `returns 400 for a repo that is not owner/name`](apps/lore-api/src/api/routes/spec-tasks/spec-tasks.test.ts#L97))

Ready returns the dependency-ready tasks for the requested repo. ([validated by `returns the dependency-ready tasks for the repo`](apps/lore-api/src/api/routes/spec-tasks/spec-tasks.test.ts#L109))

Ready without a repo is rejected with 400. ([validated by `returns 400 when repo is missing`](apps/lore-api/src/api/routes/spec-tasks/spec-tasks.test.ts#L125))

A successful claim reports `claimed: true` with the claiming agent. ([validated by `reports claimed:true and the claiming agent`](apps/lore-api/src/api/routes/spec-tasks/spec-tasks.test.ts#L133))

A task already taken reports `claimed: false` rather than erroring. ([validated by `reports claimed:false when the task is already taken`](apps/lore-api/src/api/routes/spec-tasks/spec-tasks.test.ts#L147))

Complete returns the completion flag and the newly unblocked dependents. ([validated by `returns the completion flag and newly unblocked dependents`](apps/lore-api/src/api/routes/spec-tasks/spec-tasks.test.ts#L159))

Every spec-task route returns 503 when the pool is null. ([validated by `returns 503 for every spec-task route when the pool is null`](apps/lore-api/src/api/routes/spec-tasks/spec-tasks.test.ts#L170))

The four routes are registered on the server. ([implemented by](../../../apps/lore-api/src/server/build-server.ts#L110), [implemented by](../../../apps/lore-api/src/api/routes/spec-tasks/spec-tasks.ts#L40))

## Out of Scope

- The `tasks.md` grammar itself (phases, `[P]`, `[DEPENDS ON:]`) — owned by `parseTasks`.
- The MCP tools' rendering and repo auto-detection — owned by the [`sync-tasks`](../../mcp-tools/sync-tasks/spec.md), [`ready-tasks`](../../mcp-tools/ready-tasks/spec.md), [`claim-task`](../../mcp-tools/claim-task/spec.md) and [`complete-task`](../../mcp-tools/complete-task/spec.md) specs.
- The Floor's own spec-task dispatch (`claimSpecTask` from the worker side).
