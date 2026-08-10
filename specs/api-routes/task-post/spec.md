# Feature Specification: POST /api/task

| Field      | Value                                            |
|------------|--------------------------------------------------|
| Feature    | Task action endpoint (create / mutate)           |
| Status     | In Progress                                       |
| Created    | 2026-06-10                                        |
| Owner      | Platform Engineering                             |
| Route      | `POST /api/task`                                 |
| Auth scope | `task` (prefix `/api/task` → `task`)             |
| Module     | Tasks (`api/routes/tasks.ts` → `handleTaskPost`) |

POST /api/task is the single action-dispatched write endpoint that creates a pipeline task or mutates its lifecycle (retry, cancel, set priority, status update) for the MCP server, Slack bridge, web UI, and local runner.

## Problem Statement

The MCP server, the Slack bridge, the web UI, and the local task runner all
need a single write endpoint to put a pipeline task into the system and to
mutate its lifecycle afterwards. Rather than one route per verb, `POST /api/task`
is an action-dispatched endpoint: a single body field (`action`) selects
between creating a task and the four mutations (retry, cancel, set priority,
status update). The default — no `action` and a `description` — creates a task.
The local runner reports progress back through the same endpoint with an
`action`-less, `status`-bearing body.

## Interface

Registered as `exact("/api/task", "POST")` →
`handleTaskPost(req, res, pool)`
([registration](../../../apps/lore-api/src/server/build-server.ts#L95),
[handler](../../../apps/lore-api/src/api/routes/tasks/task-post.ts#L32)). Ordered **after**
the `by-pr` / `timeline` / `/api/tasks` GET routes; method `POST` + exact path
`/api/task` is the only way in.

- **Method + path**: `POST /api/task`
- **Auth scope**: `task`. `getRequiredScope` finds no `SCOPE_OVERRIDES` match and
  the first `ROUTE_SCOPES` prefix hit is `/api/task` → `"task"`
  ([scope map](../../../apps/lore-api/src/api/routes/tasks/task-post.ts#L37)). The legacy
  `LORE_INGEST_TOKEN` and any `admin`-scoped token also pass. Rate-limit bucket
  is `task` (60/min).
- **Body**: JSON object. The `action` field is the discriminator.

### Request body by action

| `action`        | Required fields                 | Optional fields                              |
|-----------------|---------------------------------|----------------------------------------------|
| `retry`         | `task_id`                       | —                                            |
| `cancel`        | `task_id`                       | —                                            |
| `set-priority`  | `task_id`, `priority`           | — (`priority` other than `immediate` → `normal`) |
| _(none)_ status | `task_id`, `status`             | `pr_url`, `error`                            |
| _(none)_ create | `description` (non-blank)       | `task_type`, `target_repo`, `priority`, `context` |

`status` must be one of `running`, `pr-created`, `completed`, `failed`,
`needs-human-help`, `cancelled`. `task_type` is validated against
`getTaskTypes()`; an unknown or missing type falls back to `general`.
`priority` on create defaults to `normal`.

### Response status codes

| Status | When                                                                  |
|--------|-----------------------------------------------------------------------|
| 200    | Any successful action (create returns `createTask` result; mutations return an `{ ok: true }` envelope). |
| 400    | Blank `description` on create; invalid `status` value.                |
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

   This route is the only cancel path for the MCP tool: the adapter holds no pool
   (ADR-032). The web UI cancels through its own Next.js route against the
   database directly.
5. **Set priority** — if `parsed.action === "set-priority"` **and** `task_id`
   **and** `priority`: resolve `priority === "immediate" ? "immediate" : "normal"`,
   then `UPDATE pipeline.tasks SET priority = $1, updated_at = now() WHERE id = $2
   AND status = 'pending'` with `[resolvedPriority, task_id]`. Return
   `200 { ok: true, task_id, priority: resolvedPriority }`. (Only `pending` tasks
   are repriced; the response echoes the requested priority regardless of rows hit.)
6. **Status update** — if there is **no** `action` **and** both `task_id` and
   `status` are present (local-runner progress report):
   1. Reject with `400 { error: "invalid status: <status>" }` if `status` is not
      in the allow-list above.
   2. Build a dynamic `SET` clause starting `status = $1, updated_at = now()`;
      append `pr_url = $N` when `pr_url` is present and `error = $N` when `error`
      is present, pushing values in order. Push `task_id` last.
   3. `UPDATE pipeline.tasks SET <clauses> WHERE id = $<last>`.
   4. Return `200 { ok: true, task_id, status }`.
7. **Create (default)** — destructure `{ description, task_type, target_repo,
   priority, context }`:
   1. If `description?.trim()` is falsy → `400 { error: "description is required" }`.
   2. `resolvedType = getTaskTypes().includes(task_type || "") ? task_type : "general"`.
   3. `createTask(description, resolvedType, target_repo, "remote-mcp", context || undefined, priority || "normal")`.
   4. Return `200` with the `createTask` result.
8. **Catch-all** — any thrown error logs `"[api/task] error:"` and returns
   `500 { error: err.message }`.

Branch precedence is strict top-to-bottom: a `set-priority` action with no
`priority` field falls through every mutation branch and lands in **create**
(where it 400s on the missing `description`).

## Output

| Branch          | Status | Body                                              |
|-----------------|--------|---------------------------------------------------|
| retry           | 200    | `retryTask` result (e.g. `{ task_id }`)           |
| cancel          | 200    | `{ task_id, status: "cancelled" }`                 |
| cancel missing  | 404    | `{ error: "Task not found" }`                     |
| cancel terminal | 409    | `{ error: "Cannot cancel task in <state> state" }` |
| set-priority    | 200    | `{ ok: true, task_id, priority }`                 |
| status invalid  | 400    | `{ error: "invalid status: <status>" }`           |
| status update   | 200    | `{ ok: true, task_id, status }`                   |
| create blank    | 400    | `{ error: "description is required" }`            |
| create ok       | 200    | `createTask` result                               |
| parse / throw   | 500    | `{ error: <message> }`                            |
| no pool         | 503    | `{ error: "database not available" }`            |

## Dependencies & side effects

- Handler `handleTaskPost`; helpers `createTask`, `retryTask` (dynamic import),
  `getTaskTypes`, `readBody`, `json`.
- DB writes: `pipeline.tasks` (set-priority, status update); `createTask` /
  `retryTask` / `cancelPipelineTask` own their own inserts/reads, and the cancel
  path also writes `pipeline.task_events`.
- Auth: `pipeline.api_tokens` (scope check, upstream in the dispatcher).
- No GCS, no GitHub. `console.error` on the catch path.

## Acceptance Criteria

A null pool returns 503 before any body is read. ([validated by `returns 503 when pool is null`](apps/lore-api/src/api/routes/tasks/task-post.test.ts#L51))

A `retry` action returns the `retryTask` result verbatim. ([validated by `retries a task`](apps/lore-api/src/api/routes/tasks/task-post.test.ts#L57))

A `cancel` action returns the cancelled task and its new status. ([validated by `cancels a task`](apps/lore-api/src/api/routes/tasks/task-post.test.ts#L76))

Cancelling an unknown task id answers 404 rather than reporting success. ([validated by `returns 404 when cancelling a task that does not exist`](apps/lore-api/src/api/routes/tasks/task-post.test.ts#L85))

Cancelling a merged task answers 409 with the refusal reason. ([validated by `returns 409 when cancelling a merged task`](apps/lore-api/src/api/routes/tasks/task-post.test.ts#L95))

A `cancel` action records the status transition in `pipeline.task_events`. ([validated by `cancel records a task_events row for the status transition`](apps/lore-api/src/api/routes/tasks/task-post.test.ts#L250))

`set-priority` with `immediate` echoes `immediate`. ([validated by `sets immediate priority`](apps/lore-api/src/api/routes/tasks/task-post.test.ts#L107))

`set-priority` with any other value normalizes to `normal`. ([validated by `normalizes a non-immediate priority`](apps/lore-api/src/api/routes/tasks/task-post.test.ts#L123))

`set-priority` updates only `pending` tasks with the resolved priority. ([validated by `set-priority updates only pending tasks with the resolved priority`](apps/lore-api/src/api/routes/tasks/task-post.test.ts#L266))

`set-priority` missing `priority` falls through to the create branch and 400s on the missing description. ([validated by `set-priority without a priority falls through to create and 400s`](apps/lore-api/src/api/routes/tasks/task-post.test.ts#L280))

A status update with `pr_url` and `error` returns the status envelope and writes all three columns. ([validated by `updates status with pr_url and error`](apps/lore-api/src/api/routes/tasks/task-post.test.ts#L135))

A status update without optional fields still returns the status envelope. ([validated by `updates status without optional fields`](apps/lore-api/src/api/routes/tasks/task-post.test.ts#L151))

An out-of-allow-list status returns 400. ([validated by `rejects an invalid status`](apps/lore-api/src/api/routes/tasks/task-post.test.ts#L160))

A create with a known `task_type` calls `createTask` with that type. ([validated by `creates a task with a known type`](apps/lore-api/src/api/routes/tasks/task-post.test.ts#L166))

A create with an unknown `task_type` falls back to `general`. ([validated by `falls back to general for an unknown type`](apps/lore-api/src/api/routes/tasks/task-post.test.ts#L180))

A create with no `task_type` defaults to `general`. ([validated by `defaults to general when no task_type is provided`](apps/lore-api/src/api/routes/tasks/task-post.test.ts#L199))

A create threads `group_id` through to `createTask` as its trailing argument when provided. ([validated by `task-post.test.ts:213`](apps/lore-api/src/api/routes/tasks/task-post.test.ts#L213))

A blank `description` returns 400. ([validated by `returns 400 when description is blank`](apps/lore-api/src/api/routes/tasks/task-post.test.ts#L227))

Invalid JSON returns 500. ([validated by `returns 400 on invalid JSON`](apps/lore-api/src/api/routes/tasks/task-post.test.ts#L233))

The route counts against the `task` rate bucket (60/min): the 61st POST to `/api/task` in the window trips 429. ([validated by `rate-limit.test.ts:60`](apps/lore-api/src/server/plugins/rate-limit.test.ts#L60))

## Out of Scope

- `createTask` / `retryTask` internals (insert shape, group ids, dedup) — owned by `features/pipeline/pipeline.ts`.
- Bearer-token scope validation — owned by the dispatcher / `auth.ts`.
- `GET /api/task/:id` and `GET /api/tasks` (separate handlers).
