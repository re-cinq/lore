# Refactor: de-duplicate the spec-task queue mechanics

**Branch:** `investigate/project-vs-server-core-dupes`
**Date:** 2026-07-02

## Findings (what the investigation confirmed)

`libs/server-core/src/features/pipeline/tasks.ts` runs raw `pool.query` SQL that
re-implements spec-task DAG queue mechanics **already single-sourced** in
`libs/shared/src/project/tasks/` (`TaskQueueRepository` / `PgTaskQueue` /
`InMemoryTaskQueue`). The shared port's own docstring calls itself *"the org-wide
task-queue mechanics ... single-sourced here so the queue semantics have one
home."* server-core is a second home.

| server-core (rogue) | shared (canonical) | overlap |
|---|---|---|
| `getReadyTasks(pool, repo)` | `PgTaskQueue.findReadySpecTasks()` | same `depends_on` DAG `NOT EXISTS` readiness predicate; server-core adds a `target_repo` scope + different SELECT columns |
| `claimTask(pool, id, agentId)` | `PgTaskQueue.claimSpecTask(id)` | both atomically flip `pending → running`; server-core wraps it in an explicit txn + `FOR UPDATE SKIP LOCKED` + event insert |
| `completeTask(pool, id)` | *(no port method)* | pastes the **same readiness predicate a third time** to compute unblocked dependents |

The readiness predicate lived in **three** places: `PgTaskQueue.findReadySpecTasks`,
`server-core getReadyTasks`, and `server-core completeTask`'s dependents query.

Everything else in server-core (`memory`, `context-assembly`, `pipeline.ts`,
`spec-trace`) was verified **clean** — it re-exports shared or is a genuinely
different layer. Only the spec-task queue is duplicated.

## Plan

Move the SQL to the single home; make server-core delegate.

1. **Extend `TaskQueueRepository`** (port + `PgTaskQueue` + `InMemoryTaskQueue`):
   - `findReadySpecTasks(repo?)` — optional repo scope. No arg = current org-wide
     behavior (Floor's `spec-task-executor` is unaffected). With a repo, adds
     `AND t.target_repo = $1`.
   - `claimSpecTask(id, agentId?)` — optional caller-supplied claimer;
     defaults to `'spec-task-executor'` (Floor's call is unchanged).
   - `completeSpecTask(id)` — new; guards `running`, flips to `completed`, and
     returns `{ completed, unblocked }`. Computes `unblocked` by **reusing
     `findReadySpecTasks(repo)`** and filtering to same-slug dependents — so the
     readiness predicate now exists in exactly **one** SQL string.
2. **Rewrite `server-core/tasks.ts`** as thin wrappers over `new PgTaskQueue(pool)`.
   The MCP-specific audit annotations stay (the `claimed_by: 'lore_claim_task'`
   claim event and the `running → completed` event) via the shared
   `recordTaskEvent(pool, ...)` — this is the "mcp-specific policy" the sibling
   `pipeline.ts` already keeps local.
3. **Fix the adjacent consumer bug**: `pipeline-tools.ts` `lore_ready_tasks` reads
   `t.metadata?.spec_task_id` — there is no `metadata` column, so it always
   printed `undefined`. Switch to `t.context_bundle?.spec_task_id`.

## Behavior preservation

- `findReadySpecTasks(repo)` returns the `ReadySpecTask` superset the MCP consumer
  needs (`id`, `description`, `context_bundle`). The dropped `status`/`agent_id`
  columns were never read.
- The single-statement `UPDATE ... WHERE status='pending' RETURNING` claim is as
  race-safe as the old `FOR UPDATE SKIP LOCKED` ceremony for a by-id claim.
- Claim/complete audit events are still written (non-blocking, as before).

## Verification

- `libs/shared` build + typecheck.
- `libs/shared/src/project/tasks/task-queue.test.ts` — added cases for the repo
  scope, the parameterized claimer, and `completeSpecTask` (Pg + InMemory).
- `apps/mcp-server/src/features/pipeline/tasks-db.test.ts` — rewritten to assert
  delegation instead of the inlined SQL.
</content>
</invoke>
