# Tasks: Run Failure Visibility on the Feature Page

Spec: `specs/run-failure-visibility/spec.md`

Three independent slices. T001 and T002 compose (the payload field is what
the phase resolver reads), but each lands and tests on its own; T003 touches
a different file entirely and can run in parallel with both.

## Phase 1 — The run's outcome reaches the page (FR1)

- [ ] T001 [P] Carry `outcome` through `runFields()` into `FeatureRunPayload`
      in `apps/web-ui/src/lib/feature-run.ts` — add the field to the
      interface and to the destructure. Test in
      `apps/web-ui/src/lib/feature-run.test.ts`: `toFeatureRunPayload`
      projects a run's `outcome` rather than dropping it. Link the FR1
      statements in the spec to it.

## Phase 2 — A failed run is a failed phase (FR2)

- [ ] T002 In `apps/web-ui/src/lib/feature-phase.ts`, make `phaseFromLine`
      resolve `failed` from the RUN as well as from its node rows: a
      terminal run with `status === "failed"` is `{kind: "failed"}` even
      when every `station_runs` row succeeded. Keep `hasFailedNode` and the
      clean-`done` path intact. Tests in
      `apps/web-ui/src/lib/feature-phase.test.ts` covering the three FR2
      cases (run-level failure with all-success rows, node-level failure,
      clean terminal run). Link the FR2 statements.
- [ ] T003 Add the regression test that ties T001+T002 to the reported bug:
      a `failed` run with all-`success` node rows and a feature still at
      `awaiting-input` renders `FailureBlock` with the run's reason and does
      NOT render the "Create the spec PR" control. Sits with the existing
      wizard tests in
      `apps/web-ui/src/app/repos/[owner]/[repo]/features/[id]/`. Link SC1.

## Phase 3 — A refusal is shown, not thrown (FR3)

- [ ] T004 [P] In `apps/web-ui/src/lib/api/result.ts`, separate a lore-api
      REFUSAL (4xx) from a fault (5xx / unreachable): a refusal must reach
      the feature page as rendered error state rather than a thrown
      server-action error. Keep the `"<action> failed: <message>"` text.
      Update the four actions in
      `apps/web-ui/src/app/repos/[owner]/[repo]/features/[id]/actions.ts`
      (refine, create-spec-file, split, delete) to the new shape, and every
      other `enforceOk` caller the type change reaches. Tests for the 4xx
      and 5xx branches. Link the FR3 statements and SC2.

## Phase 4 — Close out

- [ ] T005 Flip `specs/run-failure-visibility/spec.md`'s `| Status |` row
      from `Draft` to `In Progress` (or `Shipped` if every testable
      statement ended up linked) — `re-lint/require-status-matches-coverage`
      errors on a mismatch, so this is not optional.
- [ ] T006 Verify: `npx eslint apps/web-ui specs/run-failure-visibility` and
      the web-ui vitest suite both green.

## Not in this breakdown

The upstream defect — a `write` node reporting success with an empty
worktree and a `push` node reporting success with nothing to push — is
out of scope per the spec and needs its own task against the station
outcome contract.
