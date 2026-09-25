# Feature Specification: GET /api/repos/:owner/:repo/ci-jobs/:job_id/log

| Field      | Value                                                       |
| ---------- | ----------------------------------------------------------- |
| Feature    | One Actions job's log, bounded                              |
| Status     | In Progress                                                 |
| Created    | 2026-09-12                                                  |
| Owner      | Platform Engineering                                        |
| Route      | `GET /api/repos/:owner/:repo/ci-jobs/:job_id/log`           |
| Auth scope | `read`                                                      |
| Module     | Repos (`routes/repos/ci-job-log.ts` → `work/ci/ci-job-log.ts`) |

GET /api/repos/:owner/:repo/ci-jobs/:job_id/log returns the tail of one GitHub Actions job's log with the per-line timestamps stripped, optionally filtered to lines containing a substring, bounded so a caller reads the part of a report it needs and never the whole run.

## Problem Statement

The failed-job account the CI verdict carries is a few lines. When a reader needs more — the rest of a typecheck report, the assertion above a test's last lines — the log is the only source, and a pod has no credential to fetch it. Handing it whole would repeat the 10,000-line dump that a lint job prints, so the read is bounded.

## Interface

- **Method + path**: `GET /api/repos/{owner}/{repo}/ci-jobs/{job_id}/log`
- **Query**: `tail` (integer 1..2000, default 200), `grep` (string, optional) ([registration](../../../apps/lore-api/src/transport/routes/repos/ci-job-log.ts#L47)).
- **Response** `200`: `{job_id, lines[], total, truncated}` (`CiJobLog` in `openapi.json`) — `total` counts the lines the filter kept, `truncated` says whether the tail left any out.

## Behavior

- The lines come back without the timestamp Actions prefixes to every line, 200 of them by default. ([validated by returns the job's log tail without timestamps, 200 lines by default](../../../apps/lore-api/src/transport/routes/repos/ci-job-log.test.ts#L51), [validated by returns the last N lines without timestamps](../../../libs/shared/src/outbound/project/pulls/check-runs.test.ts#L407))
- `grep` filters case-insensitively before the tail is taken, so a reader asking for "error" gets the findings rather than the last 200 lines of noise. ([validated by filters by grep and bounds by tail](../../../apps/lore-api/src/transport/routes/repos/ci-job-log.test.ts#L69), [validated by filters to the lines matching grep before taking the tail, case-insensitively](../../../libs/shared/src/outbound/project/pulls/check-runs.test.ts#L418), [validated by returns the job's last lines, the count the filter kept, and whether the tail cut any](../../../apps/lore-api/src/work/ci/ci-job-log.test.ts#L12))
- A job GitHub does not have is a 404. A read GitHub will not serve (a 403 when the GitHub App lacks Actions read permission on the repository, a 429 when it rate-limits) is a 424 carrying GitHub's status and its own message, with the permission reading offered only beside a 403. The status is 424 because the MCP proxy passes a non-retriable 4xx through with its body: a 5xx is retried and its body dropped, a 403 reads as the caller's own token being refused, and a 404 reads as a job that does not exist. ([validated by returns 404 when GitHub will not show the job](../../../apps/lore-api/src/transport/routes/repos/ci-job-log.test.ts#L82), [validated by returns 424 carrying GitHub's 403 and its own words when GitHub refuses the log read, a status the MCP proxy passes through with its body](../../../apps/lore-api/src/transport/routes/repos/ci-job-log.test.ts#L88), [validated by returns 424 carrying GitHub's 429 without the permission hint when GitHub rate-limits the log read](../../../apps/lore-api/src/transport/routes/repos/ci-job-log.test.ts#L100), [validated by folds the server error body into the detail on a non-retriable 4xx](../../../libs/server-core/src/outbound/proxy.test.ts#L121), [validated by returns null when GitHub will not show the job's log](../../../apps/lore-api/src/work/ci/ci-job-log.test.ts#L29))
- A tail past 2000 lines is a 400. ([validated by returns 400 for a tail past 2000 lines](../../../apps/lore-api/src/transport/routes/repos/ci-job-log.test.ts#L112))
