# Tasks: Declarative Goal Gates in Assembly-Line Definitions

Spec: [spec.md](spec.md). Every task is test-first — write the failing test, watch it fail for the right reason, then implement. One commit per task.

**Each task links its own tests.** `lore/require-spec-link` is an eslint **error**, so a test that lands without an inline `([validated by …])` in `spec.md` turns the repo red immediately — linking cannot be deferred to a closure phase. New tests are appended at EOF of their test file: four specs hold sixteen `#L` anchors into `loader.test.ts` and `transition.test.ts`, and a mid-file insertion would silently break every one.

## Phase 1 — Loader schema (FR1)

- [x] T001 `goal_gate` on the node schema — failing tests in `libs/assembly-lines/src/loader.test.ts` (a node accepts `goal_gate: true`; existing definitions without it parse unchanged), then add the optional boolean to `NodeSchema` in `libs/assembly-lines/src/loader.ts`
- [x] T002 Exit-node rejection — failing test (a definition with `goal_gate: true` on its exit node throws `AssemblyLineLoadError` naming the node), then add the check to `validateAssemblyLine` in `libs/assembly-lines/src/loader.ts`
- [x] T003 Bypass-reachability warning — failing tests (warning when some entry→exit path skips the gated node; no warning when every path crosses it), then implement the path walk in `libs/assembly-lines/src/loader.ts`
- [x] T004 Warning propagation — failing tests that the file loader, directory loader, and builtin loader all forward the warning, and that the builtin loader falls back to `console.warn` with no handler supplied; then thread the handler through `libs/assembly-lines/src/loader.ts` and `libs/assembly-lines/src/builtin-assembly-lines.ts`

## Phase 2 — Finish guard (FR2)

- [x] T005 `goal_gate_unmet` outcome — extend the `fail` variant of `Transition` in `libs/assembly-lines/src/transition.ts` to carry it (type-only; no behaviour yet)
- [x] T006 The guard — failing tests in `libs/assembly-lines/src/transition.test.ts` covering: gated node with `success` finishes; gated node with `failed` fails `goal_gate_unmet`; gated node never visited (skipped by conditional branching) fails `goal_gate_unmet`; `changes_requested` satisfies the gate; ungated definitions finish exactly as before. Then implement the guard in the `currentId === assemblyLine.exit` branch of `nextTransition()`
- [x] T007 Latest-visit semantics — failing tests (iteration 1 `changes_requested` + iteration 2 `success` finishes; iteration 1 `success` + iteration 2 `failed` fails `goal_gate_unmet`), then make the guard read each gated node's latest visit rather than any visit
- [x] T008 Diagnostic reason — failing test that the reason names every unsatisfied gate, then compose the message in `nextTransition()`
- [x] T009 Precedence check — test that a line exceeding `iteration_max` fails with `iteration_max`, not `goal_gate_unmet` (the loop fails before the finish branch). Assert-only; expected to pass on T006's implementation

## Phase 3 — Adoption (FR3)

- [x] T010 Redirect the bypass edge — failing test that `implementation.yaml` has no entry→exit path skipping `review`, then change the `implement`/`changes_requested` edge target from `retrospective` to `validate` in `libs/assembly-lines/src/assembly-lines/implementation.yaml`
- [x] T011 Gate the review nodes — failing test that both definitions carry `goal_gate: true` on `review` and that neither raises a bypass warning at load, then set the attribute in `libs/assembly-lines/src/assembly-lines/implementation.yaml` and `libs/assembly-lines/src/assembly-lines/code-review.yaml`

## Phase 4 — Surfacing the outcome (FR4)

- [x] T012 [P] Run-view label — failing test in `apps/web-ui/src/lib/assembly-line-presenter.test.ts` that `goal_gate_unmet` renders a failure-toned label, then add the case in `apps/web-ui/src/lib/assembly-line-presenter.ts`
- [x] T013 [P] Definition mirror — add `goal_gate` to `apps/web-ui/src/lib/assembly-line-definition.ts` and confirm `npm run typecheck:drift` is green (red before, green after)
- [x] T014 [P] Failure notification — failing test in `apps/floor/src/jobs/assembly-line/notify-failure.test.ts` that a `goal_gate_unmet` line notifies on the standard failure path; extend the classifier only if it does not already treat the outcome as a failure generically
- [ ] T015 [P] PR check — failing test in `apps/floor/src/jobs/assembly-line/pr-check.test.ts` that a PR-linked line closing `goal_gate_unmet` publishes a failing `lore/<definition>` check; extend only if the mapping is not already generic
- [ ] T016 [P] Escalation diagnostic — add `goal_gate_unmet` to the reason union in `apps/floor/src/jobs/platform/escalation.ts` with a covering test, if the union does not already admit it

## Phase 5 — Closure

- [ ] T017 Delete `adrs/ADR-040-goal-gates.md` — superseded by this spec
- [ ] T018 Sweep `spec.md` for any statement still unlinked (each task links its own as it lands) and settle `| Status |` on the coverage ladder
- [ ] T019 Full verification: `npx eslint .` (0 errors), `npx prettier --check` on touched files, `npm run typecheck:drift`, and the `libs/assembly-lines`, `apps/floor`, `apps/web-ui` suites green
