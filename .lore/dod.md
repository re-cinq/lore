# Definition of Done

> A run that ends without any node reporting a verdict — a crashed or cancelled pod, a timeout, a floor-side error — MUST have `triage: failed` applied to its issue by the `lore-run-settled` station, which already settles terminal floor runs.

**Strategy: `direct`** — `runSettledHandle` in `apps/stations/src/code-review/run-settled/station.ts` is the real entry point for the run-settled station; its `Handle` can be called in a test with injected deps. The seam exists today; the behaviour does not.

## Done when these pass

- [x] **applies triage: failed to the issue when the run ended without a verdict** — asserts that when `runSettledHandle` handles an `issue-triage` run with a terminal outcome (`failed`), it calls `addLabel` with `"triage: failed"` on the correct repo and issue number.
  `apps/stations/src/code-review/run-settled/triage-failed.test.ts`

## Facets

- [x] Extend `RunSettledDeps` with an `addLabel(repo, issueNumber, label)` method (or equivalent interface).
- [x] In `runSettledHandle`, detect `line_id === "issue-triage"` with a non-success terminal outcome and call `addLabel` with `"triage: failed"`, reading `issue_number` from `startValueOf(run, "issue_number")` and the repo from `loreRepoOf(run.repo)`.
- [x] Wire the new deps into `productionDeps` in `station.ts` via `project.issues.addLabel`.
- [x] Green bar.

## Out of scope

- Handling `issue-triage` runs that end as `success` (the pipeline's own label nodes handle the label in that path — FR17/FR25).
- Any change to the floor pipeline YAML or the triage label station.
