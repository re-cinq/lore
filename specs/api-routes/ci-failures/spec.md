# Feature Specification: GET /api/repos/:owner/:repo/ci-failures

| Field      | Value                                                        |
| ---------- | ------------------------------------------------------------ |
| Feature    | What CI said about a branch                                  |
| Status     | In Progress                                                  |
| Created    | 2026-09-12                                                   |
| Owner      | Platform Engineering                                         |
| Route      | `GET /api/repos/:owner/:repo/ci-failures`                    |
| Auth scope | `read`                                                       |
| Module     | Repos (`routes/repos/ci-failures.ts` → `work/ci/ci-failures.ts`) |

GET /api/repos/:owner/:repo/ci-failures reports what GitHub Actions said about a branch — the sha it judged, the verdict, and each failed check explained from its job — using lore-api's GitHub credential, so an agent pod holding none can still read the verdict on its own branch.

## Problem Statement

The CI wait already makes this judgement to route a run ([implementation-loop FR15](../../implementation-loop/spec.md)); a pod repairing the build could not ask for it and reproduced the build instead. The route is that judgement offered as a read, sharing the explainer with the wait so the two never describe one job differently.

## Interface

- **Method + path**: `GET /api/repos/{owner}/{repo}/ci-failures`
- **Query**: `branch` (string) or `pr_number` (positive integer); one is required, `branch` wins when both are given ([registration](../../../apps/lore-api/src/transport/routes/repos/ci-failures.ts#L57)).
- **Response** `200`: `{branch, judged_sha, conclusion, failures[]}` where each failure is `{name, app, job_id, annotations[], steps[], tail[]}` (`CiFailures` in `openapi.json`).

## Behavior

- The judged sha is the branch's newest commit carrying no skip-CI marker, found among its last thirty commits; the checks on that sha are the verdict, and each failed Actions job that reported nothing itself is explained from its job. ([validated by judges the branch's newest non-skip-ci commit and explains each failed check from its job](../../../apps/lore-api/src/work/ci/ci-failures.test.ts#L73), [validated by reports the branch's failed checks by branch name](../../../apps/lore-api/src/transport/routes/repos/ci-failures.test.ts#L79))
- A pull request number resolves to its head branch, so a caller holding only the number is served too; a number GitHub does not have is a 404. ([validated by resolves a pull request number to its head branch, so a caller holding only the number is served too](../../../apps/lore-api/src/work/ci/ci-failures.test.ts#L103), [validated by reports the same by pull request number, resolved to its head branch](../../../apps/lore-api/src/transport/routes/repos/ci-failures.test.ts#L88), [validated by returns null for a pull request GitHub does not have](../../../apps/lore-api/src/work/ci/ci-failures.test.ts#L111), [validated by returns 404 for a pull request GitHub does not have](../../../apps/lore-api/src/transport/routes/repos/ci-failures.test.ts#L100))
- A branch whose every commit skipped CI has no verdict: `conclusion` is `none`, no checks are read. ([validated by reports none, reading no checks, when every commit on the branch skipped CI](../../../apps/lore-api/src/work/ci/ci-failures.test.ts#L115), [validated by reports none with no failures when the branch has no judgeable commit](../../../libs/shared/src/outbound/project/pulls/check-runs.test.ts#L382))
- The report flattens each failed run for the wire — its name, app, job id, and the account already in hand — and Lore's own `lore/` checks appear like any other. ([validated by names each failed check with its job id and account, and the conclusion of the judged sha](../../../libs/shared/src/outbound/project/pulls/check-runs.test.ts#L340))
- The explainer is the one the CI wait uses: it reads a job only for a failed Actions run that reported nothing itself, reads none while the build is green, and leaves a run bare when GitHub will not show its job. ([validated by reads the job only for a failed Actions run that reported nothing itself](../../../libs/shared/src/outbound/project/pulls/check-runs.test.ts#L289), [validated by reads no job at all while the build is green, since each read costs requests](../../../libs/shared/src/outbound/project/pulls/check-runs.test.ts#L318), [validated by keeps the run bare when GitHub will not show its job](../../../libs/shared/src/outbound/project/pulls/check-runs.test.ts#L332))
- Neither `branch` nor `pr_number` is a 400; a branch GitHub does not have is a 404; an unconfigured GitHub is a 424. ([validated by returns 400 when neither branch nor pr_number is given](../../../apps/lore-api/src/transport/routes/repos/ci-failures.test.ts#L94), [validated by returns 404 for a branch GitHub does not have](../../../apps/lore-api/src/transport/routes/repos/ci-failures.test.ts#L106), [validated by returns 424 when GitHub is not configured](../../../apps/lore-api/src/transport/routes/repos/ci-failures.test.ts#L113))
