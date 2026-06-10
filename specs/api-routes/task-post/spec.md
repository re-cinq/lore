# Feature Specification: POST /api/task

| Field      | Value                                            |
|------------|--------------------------------------------------|
| Feature    | Task action endpoint (create / mutate)           |
| Status     | **Draft**                                         |
| Created    | 2026-06-10                                        |
| Owner      | Platform Engineering                             |
| Route      | `POST /api/task`                                 |
| Auth scope | `task` (prefix `/api/task` → `task`)             |
| Module     | Tasks (`api/routes/tasks.ts` → `handleTaskPost`) |

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
([registration](../../../mcp-server/src/api/routes/index.ts#L60),
[handler](../../../mcp-server/src/api/routes/tasks.ts#L30)). Ordered **after**
the `by-pr` / `timeline` / `/api/tasks` GET routes; method `POST` + exact path
`/api/task` is the only way in.

- **Method + path**: `POST /api/task`
- **Auth scope**: `task`. `getRequiredScope` finds no `SCOPE_OVERRIDES` match and
  the first `ROUTE_SCOPES` prefix hit is `/api/task` → `"task"`
  ([scope map](../../../mcp-server/src/api/routes/auth.ts#L47)). The legacy
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
4. **Cancel** — if `parsed.action === "cancel"` **and** `parsed.task_id`:
   `UPDATE pipeline.tasks SET status = 'cancelled', updated_at = now() WHERE id = $1
   AND status NOT IN ('completed', 'failed', 'cancelled', 'merged')` with
   `[task_id]`. Return `200 { ok: true, task_id }`. (No row-count check — already
   terminal tasks silently no-op but still return `ok: true`.)
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
| cancel          | 200    | `{ ok: true, task_id }`                            |
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
- DB writes: `pipeline.tasks` (cancel, set-priority, status update);
  `createTask` / `retryTask` own their own inserts/reads.
- Auth: `pipeline.api_tokens` (scope check, upstream in the dispatcher).
- No GCS, no GitHub. `console.error` on the catch path.

## Acceptance Criteria

A null pool returns 503 before any body is read. ([validated by `returns 503 when pool is null`](../../../mcp-server/src/api/routes/task-post.test.ts#L27))

A `retry` action returns the `retryTask` result verbatim. ([validated by `retries a task`](../../../mcp-server/src/api/routes/task-post.test.ts#L32))

A `cancel` action returns `{ ok: true, task_id }`. ([validated by `cancels a task`](../../../mcp-server/src/api/routes/task-post.test.ts#L37))

A `cancel` action issues the guarded `pipeline.tasks` UPDATE with the task id. ([validated by `cancel issues the guarded tasks UPDATE with the task_id`](../../../mcp-server/src/api/routes/task-post.test.ts#L95))

`set-priority` with `immediate` echoes `immediate`. ([validated by `sets immediate priority`](../../../mcp-server/src/api/routes/task-post.test.ts#L43))

`set-priority` with any other value normalizes to `normal`. ([validated by `normalizes a non-immediate priority`](../../../mcp-server/src/api/routes/task-post.test.ts#L49))

`set-priority` updates only `pending` tasks with the resolved priority. ([validated by `set-priority updates only pending tasks with the resolved priority`](../../../mcp-server/src/api/routes/task-post.test.ts#L104))

`set-priority` missing `priority` falls through to the create branch and 400s on the missing description. ([validated by `set-priority without a priority falls through to create and 400s`](../../../mcp-server/src/api/routes/task-post.test.ts#L112))

A status update with `pr_url` and `error` returns the status envelope and writes all three columns. ([validated by `updates status with pr_url and error`](../../../mcp-server/src/api/routes/task-post.test.ts#L55))

A status update without optional fields still returns the status envelope. ([validated by `updates status without optional fields`](../../../mcp-server/src/api/routes/task-post.test.ts#L61))

An out-of-allow-list status returns 400. ([validated by `rejects an invalid status`](../../../mcp-server/src/api/routes/task-post.test.ts#L67))

A create with a known `task_type` calls `createTask` with that type. ([validated by `creates a task with a known type`](../../../mcp-server/src/api/routes/task-post.test.ts#L71))

A create with an unknown `task_type` falls back to `general`. ([validated by `falls back to general for an unknown type`](../../../mcp-server/src/api/routes/task-post.test.ts#L76))

A create with no `task_type` defaults to `general`. ([validated by `defaults to general when no task_type is provided`](../../../mcp-server/src/api/routes/task-post.test.ts#L81))

A blank `description` returns 400. ([validated by `returns 400 when description is blank`](../../../mcp-server/src/api/routes/task-post.test.ts#L86))

Invalid JSON returns 500. ([validated by `returns 500 on invalid JSON`](../../../mcp-server/src/api/routes/task-post.test.ts#L90))

## Out of Scope

- `createTask` / `retryTask` internals (insert shape, group ids, dedup) — owned by `features/pipeline/pipeline.ts`.
- Bearer-token scope validation — owned by the dispatcher / `auth.ts`.
- `GET /api/task/:id` and `GET /api/tasks` (separate handlers).
