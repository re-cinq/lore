# Feature Specification: Run Failure Visibility on the Feature Page

| Field   | Value                                                              |
| ------- | ------------------------------------------------------------------ |
| Feature | Run Failure Visibility on the Feature Page                         |
| Branch  | `lore/implementation/the-feature-page-500s-when-a-p-04ba659c`     |
| Status  | Implemented                                                        |
| Created | 2026-09-17                                                         |
| Owner   | Platform Engineering                                               |

Run Failure Visibility makes a feature's detail page tell the truth about a planning line
that died: the run's own failure is carried to the page and rendered as a failure, and a
refusal from lore-api is shown where the author is reading instead of crashing the route.
Today a line that fails between nodes reads as a line that is still waiting for the author,
and the button that state offers answers with an HTTP 500.

## Problem Statement

Feature `250047fa-07ea-43de-851e-1f58b7d3e5fd` on `re-cinq/HALEngine`
(2026-09-17) planned, wrote and pushed a spec — and then the Floor could
not open the PR, because the `write` node had reported success while
committing nothing and `push` had reported success with nothing to push.
The Floor recorded the failure on the RUN
(`apps/floor/src/work/assembly-run/spec-pr.ts`: "the push node reported
success but pushed nothing"), and every `pipeline.station_runs` row stayed
`success` — the failure belongs to the transition, not to a visit.

The page showed none of it. It re-rendered the planning wizard with its
"Create the spec PR" button, the author clicked it ten times, and each
click returned **HTTP 500** from `lore.gcp.re-cinq.com`. Three defects
compose into that:

1. `FeatureRunPayload` drops the run's `outcome` column
   (`apps/web-ui/src/lib/feature-run.ts`), so the phase resolver's
   terminal branch reads `undefined` and answers `done`.
2. `featurePhaseOf` derives failure only from node outcomes
   (`hasFailedNode`), so a run-level failure has no path to `failed` —
   and `FailureBlock`, which already exists and already knows how to
   render `run.reason` with a Retry, is never mounted.
3. `enforceOk` (`apps/web-ui/src/lib/api/result.ts`) throws for every
   non-ok result. Thrown inside a `"use server"` action, lore-api's
   correct **409** ("no plan is waiting to be accepted") becomes an
   unhandled server-action error, which Next.js serves as a 500 on the
   page's own URL.

The failure reason the author needed was in the poll payload the whole
time, as both `task.failure_reason` and `run.reason`.

## FR1 — The run's outcome reaches the page

`pipeline.assembly_runs` records both `status` and `outcome`, and
`AssemblyRun` (`apps/web-ui/src/lib/assembly-run-rows.ts`) carries both.
Only the feature page's projection drops one.

- Carry the run's `outcome` through `toFeatureRunPayload` into `FeatureRunPayload`, so the field `featurePhaseOf` already reads is populated rather than always `undefined`.
- Leave every other projected column as it stands; this adds a field and changes no existing one.

## FR2 — A failed run is a failed phase

A run fails in two places, and only one of them writes a node row: a
visit can fail, and the walk between visits can fail. `featurePhaseOf`
must recognize both, because the author's page is the only surface that
reports either.

- Resolve a run whose `status` is `failed` to the `failed` phase, whatever its node rows say — a run that failed between visits carries no failed row, and the feature page is where that failure has to land.
- Keep resolving a run with a failed node row to the `failed` phase, so a visit-level failure still reports the same way it does today.
- Resolve a terminal run that did not fail to `done`, so a line that ended cleanly is unaffected by the two rules above.
- Render `FailureBlock` for a run-level failure with the run's recorded `reason`, its transcript link and its Retry — the block already renders all three, and this is the state it was written for.

## FR3 — A refusal is shown, not thrown

lore-api answers a structurally impossible action with a 4xx that names
the reason. That answer is information for the author, not a crash.

- Surface a lore-api refusal (`status: "error"` with a 4xx `code`) as an error rendered on the feature page, so the author reads what lore-api said instead of the route's 500.
- Keep a 5xx or an unreachable lore-api behaving as it does today, since a server fault is not something the author can act on in the page.
- Apply the same handling to all four feature server actions — refine, create-spec-file, split and delete — because each one calls a lore-api route that can refuse for the same structural reasons.
- Preserve the existing message shape (`"<action> failed: <what lore-api said>"`), so the text the author reads still names the action that was refused.

## Success Criteria

- SC1 — Loading a feature whose planning line is `failed` shows the recorded failure reason and a Retry, and does not offer "Create the spec PR".
- SC2 — Clicking any feature action that lore-api refuses leaves the author on the page with the refusal shown; the route returns no 5xx.
- SC3 — A feature whose line is mid-flight, parked on the author, awaiting merge or finished renders exactly as it does today.

## Out of Scope

The upstream defect that produced this run — a `write` node reporting
success with an empty worktree, and a `push` node reporting success with
nothing to push — is a separate fix in the station contract's outcome
handling. This spec covers only what the feature page does once that
failure has been recorded. Fixing the reporting does not remove the need
for the page to survive it.

## Acceptance Criteria

- `toFeatureRunPayload` carries the run's `outcome` through to the payload. ([validated by carries the run outcome so the feature phase can detect a run-level failure](apps/web-ui/src/lib/feature-run.test.ts#L119))
- A run with `status: "failed"` resolves to `{kind: "failed"}` even when all node rows report success. ([validated by reports failed when run status is failed regardless of node outcomes](apps/web-ui/src/lib/feature-phase.test.ts#L131))
- `enforceOk` returns the formatted message string for a 4xx refusal instead of throwing. ([validated by returns the message for a 4xx refusal instead of throwing, so a server action does not 500](apps/web-ui/src/lib/api/result.test.ts#L83))
- `enforceOk` continues to throw for 5xx faults. ([validated by still throws for a 5xx fault](apps/web-ui/src/lib/api/result.test.ts#L93))
