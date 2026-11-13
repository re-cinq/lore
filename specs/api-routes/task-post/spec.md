# Feature Specification: POST /api/task

| Field      | Value                                            |
|------------|--------------------------------------------------|
| Feature    | Task action endpoint (mutate)                    |
| Status     | In Progress                                       |
| Created    | 2026-06-10                                        |
| Owner      | Platform Engineering                             |
| Route      | `POST /api/task`                                 |
| Auth scope | `task` (prefix `/api/task` → `task`)             |
| Module     | Tasks (`api/routes/tasks.ts` → `handleTaskPost`) |

POST /api/task is the single action-dispatched write endpoint that mutates a pipeline task's lifecycle (retry, cancel, run now, set priority) for the MCP server and the web UI. Since 2026-10-02 it creates no task: Lore no longer runs a typed task from a description (`specs/external-floor` FR16.7).

## Problem Statement

The MCP server, the Slack bridge and the web UI all
need a single write endpoint to mutate a pipeline task's lifecycle. Rather than one route per verb, `POST /api/task`
is an action-dispatched endpoint: a single body field (`action`) selects
between the mutations (retry, cancel, run now, set priority).
A body that names no task used to create one; it is now refused with where that
work goes instead: the backlog for code and documents, a plan for a feature, and
the pull request itself for a review.
Until 2026-11-13 the local runner reported progress through the same endpoint
with an `action`-less, `status`-bearing body; the runner and that branch are
deleted, so such a body is refused like any body that names no action.

## Interface

Registered as `exact("/api/task", "POST")` →
`handleTaskPost(req, res, pool)`
([registration](../../../apps/lore-api/src/app/build-server.ts),
[handler](../../../apps/lore-api/src/transport/routes/tasks/task-post.ts)). Ordered **after**
the `by-pr` / `timeline` / `/api/tasks` GET routes; method `POST` + exact path
`/api/task` is the only way in.

- **Method + path**: `POST /api/task`
- **Auth scope**: `task`. `getRequiredScope` finds no `SCOPE_OVERRIDES` match and
  the first `ROUTE_SCOPES` prefix hit is `/api/task` → `"task"`
  ([scope map @843e714d](../../../apps/lore-api/src/transport/routes/tasks/task-post.ts#L37)). The legacy
  `LORE_INGEST_TOKEN` and any `admin`-scoped token also pass. Rate-limit bucket
  is `task` (60/min).
- **Body**: JSON object. The `action` field is the discriminator.

### Request body by action

| `action`        | Required fields                 | Optional fields                              |
|-----------------|---------------------------------|----------------------------------------------|
| `retry`         | `task_id`                       | —                                            |
| `cancel`        | `task_id`                       | —                                            |
| `run-now`       | `task_id`                       | —                                            |
| `revise`        | `task_id`                       | — (always refused with `409`: a pull request is revised by a review on it) |
| `set-priority`  | `task_id`, `priority`           | — (`priority` other than `immediate` → `normal`) |

### Response status codes

| Status | When                                                                  |
|--------|-----------------------------------------------------------------------|
| 200    | Any successful action.                                                |
| 400    | A body that names no task (nothing is created here) |
| 500    | JSON parse error or any thrown handler error.                         |
| 503    | `pool` is null (database not available).                              |

## Behavior

1. **Pool gate** — if `pool` is null, return `503 { "error": "database not available" }`.
2. Read the raw body with `readBody`; `JSON.parse` it. A parse failure throws into
   the outer `catch` (step 8).
3. **Retry** — if `parsed.action === "retry"` **and** `parsed.task_id`:
   dynamically import `retryTask`, call `retryTask(parsed.task_id)`, and return
   `200` with that result verbatim.
4. **Cancel** — if `parsed.action === "cancel"` **and** `parsed.task_id`: call the
   shared `cancelPipelineTask(pool, task_id)`, which reads the task, refuses a
   `merged`/`failed`/`cancelled` one, flips the status, and records the
   transition in `pipeline.task_events`. Return `200 { task_id, status:
   "cancelled" }`. Its two throws map to status codes rather than a 500:
   `Task not found` → `404`, any other refusal (a terminal state) → `409`, each
   with `{ error: <message> }`. A cancel is never a silent no-op — the caller
   learns why it was refused, which is what `lore_cancel_task` reports.

   This route is the only cancel path for BOTH callers: the MCP adapter holds no
   pool (ADR-032), and the web UI's `/api/tasks/[id]/cancel` proxy now forwards
   here instead of running its own SQL. That is what closed a real split — the
   proxy guarded with the UI's `isCancellable` (terminal at `completed`) while
   this seam did not list `completed`, so the same click answered 400 in the
   browser and 200 through the API. `completed` is now terminal here too.

5. **Run now** — if `parsed.action === "run-now"` **and** `parsed.task_id`: call
   the shared `escalatePipelineTask(pool, task_id)`, which refuses anything past
   `pending`, sets `priority = 'immediate'`, and records the transition in
   `pipeline.task_events` with the priority it left behind. Return `200
   { task_id, priority: "immediate" }`; its throws map exactly as cancel's do.
   Distinct from `set-priority` below, which is the MCP's blunt repricing: it
   writes no event and reports success even when the `AND status = 'pending'`
   guard matched no row.
6. **Set priority** — if `parsed.action === "set-priority"` **and** `task_id`
   **and** `priority`: resolve `priority === "immediate" ? "immediate" : "normal"`,
   then `UPDATE pipeline.tasks SET priority = $1, updated_at = now() WHERE id = $2
   AND status = 'pending'` with `[resolvedPriority, task_id]`. Return
   `200 { ok: true, task_id, priority: resolvedPriority }`. (Only `pending` tasks
   are repriced; the response echoes the requested priority regardless of rows hit.)
7. **No task named** — a body that matched no branch above is refused with
   `400` and the pointer to where that work goes now. Nothing is created.
8. **Catch-all** — any thrown error logs `"[api/task] error:"` and returns
   `500 { error: err.message }`.

Branch precedence is strict top-to-bottom: a `set-priority` action with no
`priority` field falls through every mutation branch and is refused with `400`.

## Output

| Branch          | Status | Body                                              |
|-----------------|--------|---------------------------------------------------|
| retry           | 200    | `retryTask` result (e.g. `{ task_id }`)           |
| cancel          | 200    | `{ task_id, status: "cancelled" }`                 |
| cancel missing  | 404    | `{ error: "Task not found" }`                     |
| cancel terminal | 409    | `{ error: "Cannot cancel task in <state> state" }` |
| set-priority    | 200    | `{ ok: true, task_id, priority }`                 |
| no task named   | 400    | `{ error: "Lore no longer runs typed tasks, …" }` |
| revise          | 409    | `{ error: "A task is no longer revised from here. …" }` |
| parse / throw   | 500    | `{ error: <message> }`                            |
| no pool         | 503    | `{ error: "database not available" }`            |

## Dependencies & side effects

- Handler `handleTaskPost`; helpers `retryTask` (dynamic import), `readBody`, `json`.
- DB writes: `pipeline.tasks` (set-priority);
  `retryTask` / `cancelPipelineTask` own their own inserts/reads, and the cancel
  path also writes `pipeline.task_events`.
- Auth: `pipeline.api_tokens` (scope check, upstream in the dispatcher).
- No GCS, no GitHub. `console.error` on the catch path.

## Acceptance Criteria

A null pool returns 503 before any body is read. ([validated by returns 503 when pool is null @254c21f5](apps/lore-api/src/transport/routes/tasks/task-post.test.ts#L70))

A `retry` action returns the `retryTask` result verbatim. A retry that is refused answers `409` with the reason, and `404` for a task that does not exist, as cancel, run-now and revise do; a failed `implementation` or `general` task cannot be retried, because its type was removed, and stays failed. ([validated by retries a task @4e2806c3](apps/lore-api/src/transport/routes/tasks/task-post.test.ts#L76), [validated by answers 409 with the reason when retrying a failed implementation task, whose type was removed @76f47914](apps/lore-api/src/transport/routes/tasks/task-post.test.ts#L83), [validated by answers 404 when retrying a task that does not exist @fd36aacd](apps/lore-api/src/transport/routes/tasks/task-post.test.ts#L95), [validated by refuses to retry a failed implementation task, whose type was removed, and leaves it failed @a94ddde5](libs/shared/src/domain/pipeline-tasks.escalate.test.ts#L91))

A `cancel` action returns the cancelled task and its new status. ([validated by cancels a task @4a1144b3](apps/lore-api/src/transport/routes/tasks/task-post.test.ts#L113))

Cancelling an unknown task id answers 404 rather than reporting success. ([validated by returns 404 when cancelling a task that does not exist @79600dbb](apps/lore-api/src/transport/routes/tasks/task-post.test.ts#L122))

Cancelling a merged task answers 409 with the refusal reason. ([validated by returns 409 when cancelling a merged task @d684af3a](apps/lore-api/src/transport/routes/tasks/task-post.test.ts#L132))

A `cancel` action records the status transition in `pipeline.task_events`. ([validated by cancel records a task_events row for the status transition @d492c271](apps/lore-api/src/transport/routes/tasks/task-post.test.ts#L276))

A `cancel` action also ends every assembly run still open for the task, as `finished` with outcome `cancelled`, leaving other tasks' runs alone — a run left running kept its plan's subject lock, kept waiting on a closed spec PR, and was resumed by a later Retry (plan 3b3a67af, run 18773dbb, 2026-09-28). ([validated by cancels task t1 and ends its open run as cancelled, leaving task t2's run running @cae05f0f](apps/lore-api/src/work/pipeline/cancel-task.test.ts#L20))

A cancel the task refuses ends no run. ([validated by ends no run when the task itself cannot be cancelled @9e076fbf](apps/lore-api/src/work/pipeline/cancel-task.test.ts#L52))

A `run-now` action escalates a pending task and answers with its new priority. ([validated by escalates a pending task to immediate @1f3cee83](apps/lore-api/src/transport/routes/tasks/task-post.test.ts#L144))

Escalating an unknown task id answers 404 rather than reporting success. ([validated by returns 404 when escalating a task that does not exist @717b9e69](apps/lore-api/src/transport/routes/tasks/task-post.test.ts#L153))

Escalating a task past `pending` answers 409 with the refusal reason, because a caller told "ok" for a task that never moved cannot tell the difference. ([validated by returns 409 when escalating a running task @7e414076](apps/lore-api/src/transport/routes/tasks/task-post.test.ts#L163))

A `revise` action queues nothing and answers `409`, pointing at a review that requests changes on the pull request: Lore answers it there. ([validated by queues no revision of task t1 and points at a review on its pull request @9374172b](apps/lore-api/src/transport/routes/tasks/task-post.test.ts#L175))

`set-priority` with `immediate` echoes `immediate`. ([validated by sets immediate priority @afffe38d](apps/lore-api/src/transport/routes/tasks/task-post.test.ts#L190))

`set-priority` with any other value normalizes to `normal`. ([validated by normalizes a non-immediate priority @c1cc901b](apps/lore-api/src/transport/routes/tasks/task-post.test.ts#L206))

`set-priority` updates only `pending` tasks with the resolved priority. ([validated by set-priority updates only pending tasks with the resolved priority @4e97e632](apps/lore-api/src/transport/routes/tasks/task-post.test.ts#L292))

`set-priority` missing `priority` changes nothing and answers `400`. ([validated by set-priority without a priority changes nothing and answers 400 @b2c7ef11](apps/lore-api/src/transport/routes/tasks/task-post.test.ts#L306))

A body with a `task_id` and a `status` but no `action` changes nothing and is refused like any body that names no action. ([validated by answers 400 with where the work goes now for a status-only body @ad5d090e](apps/lore-api/src/transport/routes/tasks/task-post.test.ts#L218))

No task is created from a description, whatever type the body names: the answer is `400` with where that work goes now (an issue with a `priority:*` label, a plan, or the review every pull request already gets). ([validated by creates no %s task and says where that work goes now @3da0ea7e](apps/lore-api/src/transport/routes/tasks/task-post.test.ts#L249), [validated by creates nothing for a body that names neither a task nor a type @59811ed1](apps/lore-api/src/transport/routes/tasks/task-post.test.ts#L263))

Invalid JSON returns 500. ([validated by returns 400 on invalid JSON, not 500 @324140cb](apps/lore-api/src/transport/routes/tasks/task-post.test.ts#L270))

The route counts against the `task` rate bucket (60/min): the 61st POST to `/api/task` in the window trips 429. ([validated by `rate-limit.test.ts@a945c5d2`](apps/lore-api/src/transport/http/rate-limit.test.ts#L86))

## Out of Scope

- `retryTask` internals — owned by `features/pipeline/pipeline.ts`.
- Bearer-token scope validation — owned by the dispatcher / `auth.ts`.
- `GET /api/task/:id` and `GET /api/tasks` (separate handlers).
