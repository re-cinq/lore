# Feature Specification: lore_get_job_logs MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_get_job_logs MCP Tool          |
| Status  | Draft                          |
| Created | 2026-06-10                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_get_job_logs`                 |
| Module  | pipeline (`pipeline-tools.ts`) |
| Scope   | shared                         |

## Problem Statement

Scheduled batch jobs (K8s CronJobs — context reindex, spec-test linker, etc.)
record their stdout/stderr in GCS keyed by job name and run id
(`pipeline.job_runs.id`). When a scheduled run misbehaves, the operator needs
that full log by `(job_name, run_id)` without cluster access.

## Interface

Registered via `server.tool` ([registration + handler](apps/mcp-server/src/mcp/tools/pipeline-tools.ts#L392)).

- **name**: `lore_get_job_logs`
- **description** (verbatim):

```text
Fetches the full stdout/stderr of one scheduled CronJob run (keyed by job_name + run_id), returning {logs, complete:true}. Use for scheduled jobs like context_reindex or spec_test_linker. Instead: lore_get_task_logs for a user-created pipeline task's logs (by UUID).
```

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `job_name` | string | yes | — | Scheduled job name, e.g. `context_reindex` or `spec_test_linker`. |
| `run_id` | string | yes | — | Run UUID from `pipeline.job_runs`. |

## Behavior

1. **Transport branch on `process.env.LORE_DB_HOST`:**
   - **stdio mode (no `LORE_DB_HOST`)** — if `LORE_API_URL` + `LORE_INGEST_TOKEN`
     are set, `GET {LORE_API_URL}/api/job-run-logs?job_name&run_id` with bearer
     token; on 2xx return the raw body. Otherwise (or non-2xx) return
     `"Job-run logs require LORE_API_URL."`
   - **GKE mode (`LORE_DB_HOST` set)** — direct GCS read (below).
2. **GCS read** ([GCS read body](../../../apps/mcp-server/src/mcp/tools/pipeline-tools.ts#L417)) —
   dynamically import `@google-cloud/storage`; bucket =
   `process.env.LORE_LOG_BUCKET || "lore-task-logs"`; object key
   `__job_runs__/{job_name}/{run_id}/output.log`.
   - `file.exists()` false → return `{logs: "", complete: true}`.
   - Otherwise `file.download()`, return `{logs: content.toString("utf-8"), complete: true}`
     (full body, no offset slicing — these runs are bounded).
3. Any thrown error is caught and returned as `"Error: {message}"`.

## Output

A single MCP text content block — one of: the proxied body,
`"Job-run logs require LORE_API_URL."`, the compact
`{"logs":…,"complete":true}` JSON, or `"Error: {message}"`. **Never throws.**

## Dependencies & side effects

- GCS bucket `LORE_LOG_BUCKET` (default `lore-task-logs`), object
  `__job_runs__/{job_name}/{run_id}/output.log`.
- Env: `LORE_DB_HOST` (transport switch), `LORE_API_URL`, `LORE_INGEST_TOKEN`
  (proxy path), `LORE_LOG_BUCKET`.
- GET `/api/job-run-logs` on the GKE server (stdio path).
- No DB access in this handler (run rows are written by the agent's job-runner;
  this tool only reads GCS / proxies).

## Acceptance Criteria

An existing run's full log body is returned with `complete: true`.
*(untested: the GCS download is inline in the handler closure against `@google-cloud/storage`, with no injectable bucket seam — live-IO.)*

A missing log object returns empty logs with `complete: true`.
*(untested: same GCS `file.exists()` live-IO path, not extracted.)*

In stdio mode the request proxies to the API with the job name and run id.
*(untested: proxy path performs a live `fetch` to `LORE_API_URL`, not extracted.)*

The `/api/job-run-logs` HTTP route (the stdio-proxy target) reads the run's GCS object and returns `{logs, complete}`: the full body with `complete: true` when the object exists, empty with `complete: false` when it does not, 400 when `job_name`/`run_id` are missing, and 500 on a storage error. ([validated by GET /api/job-run-logs returns the file content when it exists](apps/lore-api/src/api/routes/tasks/job-run-logs.test.ts#L51), [`job-run-logs.test.ts:44`](apps/lore-api/src/api/routes/tasks/job-run-logs.test.ts#L44), [`job-run-logs.test.ts:38`](apps/lore-api/src/api/routes/tasks/job-run-logs.test.ts#L38), [`job-run-logs.test.ts:59`](apps/lore-api/src/api/routes/tasks/job-run-logs.test.ts#L59))

## Out of Scope

- Per-task agent logs (covered by `lore_get_task_logs`).
- Job scheduling / run-row creation (the agent job-runner owns that).
