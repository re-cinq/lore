# Feature Specification: lore_get_task_logs MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_get_task_logs MCP Tool         |
| Status  | In Progress                    |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_get_task_logs`                |
| Module  | pipeline (`pipeline/get-task-logs.ts`) |
| Scope   | shared                         |

`lore_get_task_logs` fetches a pipeline task's execution transcript by id — NDJSON turn envelopes when the task has recorded agent turns, the raw captured output otherwise — supporting incremental polling from a UTF-16 code-unit offset and reporting whether the task has finished so a poller knows when to stop.

## Problem Statement

While a task runs (and after it finishes) the developer wants its execution
transcript without opening the GKE console or the web UI. Polling should be
incremental — only the code units after a known offset — and the response should
say whether the task has finished so a poller can stop.

## Interface

Registered via `server.tool` ([registration + handler](apps/mcp-server/src/transport/tools/pipeline/get-task-logs.ts)).

- **name**: `lore_get_task_logs`
- **description** (verbatim):

```text
Fetches one pipeline task's execution transcript (by UUID), returning {logs, next_offset, complete, cursor?}. Tasks with recorded agent turns return NDJSON — one {source, event} stream-json envelope per line from the turn store; tasks with no recorded turns fall back to the raw captured output. Responses may be capped: pass next_offset back as offset (and cursor back verbatim, when present) and poll until complete is true. Instead: lore_get_job_logs (job_name + run_id) for scheduled CronJob run logs.
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `task_id` | string | yes | — | UUID of the pipeline task. |
| `offset` | number | no | `0` | UTF-16 code-unit offset (not bytes) into the flattened transcript; pass previous `next_offset` to poll incrementally. |
| `cursor` | string | no | — | Opaque resume cursor from the previous response; pass it back only together with that response's `next_offset` as `offset`. Omit it when reading from any other offset. |

## Behavior

The handler is an API proxy only. The adapter holds no database pool and no GCS
client (ADR-032); lore-api resolves the task's repository from `task_id` and
reads the transcript *(amended 2026-11-13)*.

1. **Credentials** — when `LORE_API_URL` or `LORE_INGEST_TOKEN` is unset, return
   `"Task logs require LORE_API_URL."` without fetching.
2. **Proxy read** — `GET {LORE_API_URL}/api/task-logs?task_id&offset[&cursor]`
   with the bearer token and a 30 s `AbortSignal.timeout`
   ([shared log read](../../../apps/mcp-server/src/transport/tools/pipeline/shared/cached-log-read.ts)).
   `cursor` is sent only when the caller passed one.
   - 2xx → return the body as compact JSON (`JSON.stringify(await res.json())`).
   - 401 or 403 → the shared denied error for `lore_get_task_logs`.
   - any other status → the shared unreachable error, carrying `HTTP {status} {statusText}`.
3. **Read cache** — the read goes through `withReadCache` keyed on
   `{task_id, offset}` plus `cursor` when present, TTL 86400 s. A body is cached
   only when it parses to `complete === true`, so a running task is fetched
   again on every poll.
4. A thrown error (a network failure, the timeout) is caught and returned as
   `"Error getting task logs: {message}"`.

## Output

A single MCP text content block, one of: `"Task logs require LORE_API_URL."`,
the proxied body (`{"logs":…,"next_offset":…,"complete":…}`, with `cursor` when
the API sends one), the denied error, the unreachable error, or
`"Error getting task logs: {message}"`. **Never throws.**

## Dependencies & side effects

- `GET /api/task-logs` on lore-api, which owns the task lookup, the turn store
  read and the stored-output fallback (`specs/api-routes/task-logs/spec.md`).
- Env: `LORE_API_URL`, `LORE_INGEST_TOKEN`.
- The read cache (`withReadCache`). No other side effect.

## Acceptance Criteria

The registered tool description is byte-identical to this spec's verbatim description block, so the two cannot drift apart silently.
([validated by carries the verbatim description block of specs/mcp-tools/get-task-logs/spec.md @c3dd8942](apps/mcp-server/src/transport/tools/pipeline/get-task-logs.test.ts#L131), [validated by passes cursor c9 back with offset 5 @ab35d332](apps/mcp-server/src/transport/tools/pipeline/get-task-logs.test.ts#L57), [validated by serves a complete transcript from the cache on the second read @b789069b](apps/mcp-server/src/transport/tools/pipeline/get-task-logs.test.ts#L98), [validated by fetches an incomplete transcript again on the second read @bbd1718e](apps/mcp-server/src/transport/tools/pipeline/get-task-logs.test.ts#L110), [validated by fetches a transcript with no JSON body again on the second read @cd8b2c23](apps/mcp-server/src/transport/tools/pipeline/get-task-logs.test.ts#L122))

The tool requires `LORE_API_URL`/`LORE_INGEST_TOKEN`,
proxies to `GET /api/task-logs` and returns the proxied body on success, a 401
is reported as a denied error, and a non-auth failure (e.g. 500) is reported
as unreachable. ([validated by reports the require-URL message without fetching when the env is unset @175b1c9e](apps/mcp-server/src/transport/tools/pipeline/get-task-logs.test.ts#L32), [validated by returns the error text when fetch throws @4e3f3612](apps/mcp-server/src/transport/tools/pipeline/get-task-logs.test.ts#L90), [`lore_get_task_logs
returns the proxied body on
success`](apps/mcp-server/src/transport/tools/pipeline/get-task-logs.test.ts#L41), [`lore_get_task_logs
reports a denied error on a
401`](apps/mcp-server/src/transport/tools/pipeline/get-task-logs.test.ts#L66), [`lore_get_task_logs
reports an unreachable error on a non-auth
failure`](apps/mcp-server/src/transport/tools/pipeline/get-task-logs.test.ts#L78))

## Out of Scope

- Scheduled batch-job (CronJob) logs (covered by `lore_get_job_logs`).
- Log retention / bucket lifecycle (infra concern).
