# Feature Specification: Run Failure Visibility on the Feature Page

| Field   | Value                                            |
|---------|--------------------------------------------------|
| Feature | Run Failure Visibility on the Feature Page       |
| Branch  | `lore/implementation/the-feature-page-500s-when-a-p-04ba659c` |
| Status  | Implemented                                      |
| Created | 2026-09-17                                       |
| Owner   | Platform Engineering                             |

The feature detail page returns HTTP 500 when clicking "Create the spec PR" after a
planning line failed at the run level rather than at a node. Three defects compose into
the 500: `FeatureRunPayload` drops the run's `outcome`; `featurePhaseOf` derives failure
only from node outcomes so a run-level failure reads as `done`; and `enforceOk` throws
for every non-ok result including 4xx refusals.

## Problem Statement

Run `89ca1d8b` finished with `status: "failed"` (the push node reported success but
pushed nothing — the branch had no commits). Every `pipeline.station_runs` row was
`outcome: "success"`, so the failure belonged to the transition, not to a visit.

Because `FeatureRunPayload` omitted `outcome`, `featurePhaseOf` could not see the
run-level failure. `terminalPhase()` fell through to `{kind: "done"}`, which sent
the wizard back to `awaiting-input` state — still showing "Create the spec PR".
Clicking it triggered `handleCreateSpecFile`, which called `enforceOk` on a 409 from
lore-api. `enforceOk` threw; the throw propagated out of the server action; Next.js
served it as a 500.

## What Was Built

**FR1 — the run's `outcome` reaches the page.** `runFields()` in `feature-run.ts` now
includes `outcome` in the columns it picks from `AssemblyRun`, and `FeatureRunPayload`
declares it. No other projected column changed.

**FR2 — a failed run is a failed phase.** `phaseFromLine()` in `feature-phase.ts` now
checks `run.status === "failed"` before inspecting node outcomes. A run whose status is
`failed` resolves to `{kind: "failed"}` whatever its node rows say. The node-level
failure path and the clean-terminal `done` path are intact.

**FR3 — a refusal is shown, not thrown.** `enforceOk` in `result.ts` separates a
lore-api **refusal** (4xx, HTTP code 400–499) from a **fault** (5xx / unreachable /
unconfigured): a refusal is returned as the formatted error string instead of thrown,
so a server action can surface it as rendered state. All four feature actions
(`refineFeatureAction`, `handleCreateSpecFile`, `splitFeatureAction`,
`deleteFeatureAction`) return `Promise<string | void>` and forward the refusal string
to their callers. `usePlanningRound` captures it in `actionError` state, displayed as
an Alert near the submit buttons. The analysis view hides "Create the spec PR" when
the phase is `failed`.

## Acceptance Criteria

- `toFeatureRunPayload` carries the run's `outcome` through to the payload. ([validated by carries the run outcome so the feature phase can detect a run-level failure](apps/web-ui/src/lib/feature-run.test.ts#L119))
- A run with `status: "failed"` resolves to `{kind: "failed"}` even when all node rows report success. ([validated by reports failed when run status is failed regardless of node outcomes](apps/web-ui/src/lib/feature-phase.test.ts#L131))
- `enforceOk` returns the formatted message string for a 4xx refusal instead of throwing. ([validated by returns the message for a 4xx refusal instead of throwing, so a server action does not 500](apps/web-ui/src/lib/api/result.test.ts#L83))
- `enforceOk` continues to throw for 5xx faults. ([validated by still throws for a 5xx fault](apps/web-ui/src/lib/api/result.test.ts#L93))
