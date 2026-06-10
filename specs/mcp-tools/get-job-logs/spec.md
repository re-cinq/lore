# Feature Specification: get_job_logs Tool

| Field    | Value                  |
|----------|------------------------|
| Feature  | get_job_logs           |
| Status   | **Draft**              |
| Created  | 2026-06-10             |
| Owner    | Platform Engineering   |
| Tool     | `get_job_logs`         |
| Module   | mcp-server (pipeline)  |
| Scope    | shared                 |

## Problem Statement

Scheduled batch jobs (K8s CronJobs — context reindex, spec-test linker,
etc.) record their stdout/stderr in GCS keyed by job name and run id
(`pipeline.job_runs.id`). When a scheduled run misbehaves, the operator
needs that full log by `(job_name, run_id)` without cluster access.

## Solution

A `get_job_logs` MCP tool that reads `__job_runs__/<job_name>/<run_id>/output.log`:
in GKE mode directly from the GCS log bucket (returning `{logs, complete}`
with the full body); in stdio mode by proxying to `GET /api/job-run-logs`.
A missing object returns empty logs with `complete: true`.

- IMPLEMENTED_BY: registration + handler — [`pipeline-tools.ts#L392`](../../../mcp-server/src/mcp/tools/pipeline-tools.ts#L392)
- IMPLEMENTED_BY: GCS read body — [`pipeline-tools.ts#L417`](../../../mcp-server/src/mcp/tools/pipeline-tools.ts#L417)

## Acceptance Criteria

1. An existing run's full log body is returned with `complete: true`. (untested: the GCS download is inline in the handler closure against `@google-cloud/storage`, with no injectable bucket seam — live-IO)
2. A missing log object returns empty logs with `complete: true`. (untested: same GCS `file.exists()` live-IO path, not extracted)
3. In stdio mode the request proxies to the API with the job name and run id. (untested: proxy path performs a live `fetch` to `LORE_API_URL`, not extracted)

## Out of Scope

- Per-task agent logs (covered by `get_task_logs`).
- Job scheduling / run-row creation (the agent job-runner owns that).
