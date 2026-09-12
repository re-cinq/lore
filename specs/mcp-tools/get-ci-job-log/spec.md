# Feature Specification: lore_get_ci_job_log MCP Tool

| Field   | Value                          |
|---------|--------------------------------|
| Feature | lore_get_ci_job_log MCP Tool   |
| Status  | In Progress                    |
| Created | 2026-09-12                     |
| Owner   | Platform Engineering           |
| Tool    | `lore_get_ci_job_log`          |
| Module  | ci (`ci-tools.ts`)             |
| Scope   | shared (served in agent mode)  |

`lore_get_ci_job_log` returns the tail of one GitHub Actions job's log, timestamps stripped and optionally filtered to lines containing a substring, so a caller that needs more than a failure's annotations and tail reads the part it needs rather than re-running the job.

## Problem Statement

A failed job's account from `lore_get_ci_failures` is bounded: a few annotations, the failed steps, the failing step's tail. A typecheck that reports forty errors, or a test run whose failure is above the last lines, needs more of the log — and a pod has no GitHub token to fetch it. The 10,000-line lint dump that CI printed for run 997026f5 is exactly what a caller must NOT be handed whole, so the read is bounded by a tail and narrowed by a grep.

## Interface

Registered via `server.tool` ([registration + handler](../../../apps/mcp-server/src/transport/tools/ci-tools.ts#L130)), in `registerSharedTools`, so the agent-mode gateway serves it.

### Input schema (Zod)

| Param | Type | Required | Default | Constraint / notes |
|-------|------|----------|---------|--------------------|
| `repo` | string | no | git remote of the cwd | `owner/repo`. |
| `job_id` | number | yes | — | The `job_id` of a failure reported by `lore_get_ci_failures`. |
| `tail` | number | no | 200 | Last N lines to return, 1..2000. |
| `grep` | string | no | — | Case-insensitive substring; only matching lines are kept, before the tail is taken. |

## Behavior

- It proxies `GET /api/repos/{owner}/{repo}/ci-jobs/{job_id}/log` ([route spec](../../api-routes/ci-job-log/spec.md)) with the tail and grep given, URL-encoded, and returns the slice as pretty JSON. ([validated by asks for the job's tail with the grep and tail given, encoded](../../../apps/mcp-server/src/transport/tools/ci-tools.test.ts#L130))
- With no tail it asks for 200 lines. ([validated by asks for 200 lines when no tail is given](../../../apps/mcp-server/src/transport/tools/ci-tools.test.ts#L161))

## Output

One MCP text block: `{job_id, lines[], total, truncated}` as JSON, a "specify repo" line, or the API's refusal. **Never throws.**
