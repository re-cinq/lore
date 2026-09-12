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

- The lines come back without the timestamp Actions prefixes to every line, 200 of them by default. ([validated by returns the job's log tail without timestamps, 200 lines by default](../../../apps/lore-api/src/transport/routes/repos/ci-job-log.test.ts#L37), [validated by returns the last N lines without timestamps](../../../libs/shared/src/outbound/project/pulls/check-runs.test.ts#L402))
- `grep` filters case-insensitively before the tail is taken, so a reader asking for "error" gets the findings rather than the last 200 lines of noise. ([validated by filters by grep and bounds by tail](../../../apps/lore-api/src/transport/routes/repos/ci-job-log.test.ts#L55), [validated by filters to the lines matching grep before taking the tail, case-insensitively](../../../libs/shared/src/outbound/project/pulls/check-runs.test.ts#L413), [validated by returns the job's last lines, the count the filter kept, and whether the tail cut any](../../../apps/lore-api/src/work/ci/ci-job-log.test.ts#L12))
- A job GitHub will not show is a 404, not a thrown 403. ([validated by returns 404 when GitHub will not show the job](../../../apps/lore-api/src/transport/routes/repos/ci-job-log.test.ts#L68), [validated by returns null when GitHub will not show the job's log](../../../apps/lore-api/src/work/ci/ci-job-log.test.ts#L29))
- A tail past 2000 lines is a 400. ([validated by returns 400 for a tail past 2000 lines](../../../apps/lore-api/src/transport/routes/repos/ci-job-log.test.ts#L74))
