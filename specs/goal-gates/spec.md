# Feature Specification: Declarative Goal Gates in Assembly-Line Definitions

| Field   | Value                                               |
| ------- | --------------------------------------------------- |
| Feature | Declarative Goal Gates in Assembly-Line Definitions |
| Branch  | feat/goal-gates                                     |
| Status  | Implemented                                         |
| Created | 2026-08-07                                          |
| Owner   | Platform Engineering                                |

Goal Gates add a `goal_gate: true` node attribute to assembly-line YAML: a line may not reach its terminal success state unless every goal-gated node recorded a successful outcome. The invariant moves out of the graph's topology and into the definition, where a reviewer of a definition change can see it.

Supersedes ADR-040, which this feature replaces — the ADR described work to do rather than a decision already taken.

## Problem Statement

Whether an assembly line "succeeded" is currently implicit in two places, neither of them the definition: the graph's shape, and code-side outcome precedence (`stationNodeOutcome()`, edge selection in `nextTransition()`).

A definition author who wants "this line does not count as done unless review passed" must express it by wiring edges so that no path from entry reaches the terminal node without passing through the review node. That is easy to get wrong as definitions grow conditional branches, and it is invisible to anyone auditing the YAML — the reader must simulate every path to discover the invariant.

The concrete failure mode is a silently green line. `implementation.yaml` routes `changes_requested` from its implement node in a way that can bypass review, and a line that skipped or failed its review currently closes as a finished success. Under dark-factory mode, a finished-success line is an input to `evaluateAutoMerge()`, so a bypassed review can contribute to an automatic merge.

StrongDM's Attractor spec models this as a first-class `goal_gate` node attribute: exit is refused until every gated node reached SUCCESS (or PARTIAL_SUCCESS). This feature adopts that idea against Lore's replay-based walk.

## Goals & Non-Goals

**Goals.** Make a line's success criteria declarative, auditable in the YAML, and enforced by the same pure replay that already derives every other routing decision.

**Non-Goals.** No change to how a node's own outcome is determined (`stationNodeOutcome()` keeps that authority), no new escalation mechanism, and no per-node retry policy.

## Functional Requirements

### FR1 — Loader schema

- The loader accepts an optional `goal_gate: true` on any node, and existing definitions that omit it parse unchanged — the attribute is opt-in ([validated by `loader.test.ts:674`](libs/assembly-lines/src/loader.test.ts#L674), [`loader.test.ts:698`](libs/assembly-lines/src/loader.test.ts#L698))
- `goal_gate` on the exit node is rejected at load. The walk records no visit for the terminal marker, so such a gate could never be satisfied and the line would fail forever; failing at load is the honest outcome ([validated by `loader.test.ts:721`](libs/assembly-lines/src/loader.test.ts#L721))
- The loader surfaces a validation warning when a goal-gated node can be bypassed on some path from entry to exit, so the author learns at load time rather than at the first skipped run ([validated by `loader.test.ts:802`](libs/assembly-lines/src/loader.test.ts#L802))
- No warning is raised when every path from entry to exit passes through the gated node ([validated by `loader.test.ts:814`](libs/assembly-lines/src/loader.test.ts#L814))
- The warning reaches the loading callers, not only direct `parseAssemblyLine` users: the file loader, the directory loader, and the builtin loader all forward it ([validated by `loader.test.ts:834`](libs/assembly-lines/src/loader.test.ts#L834), [`loader.test.ts:844`](libs/assembly-lines/src/loader.test.ts#L844), [`loader.test.ts:879`](libs/assembly-lines/src/loader.test.ts#L879))
- With no warning handler supplied, bypass warnings reach `console.warn` — the builtin loader inherits the directory loader's default sink — so a bypassable gate is visible at server startup instead of being silently swallowed ([validated by `loader.test.ts:854`](libs/assembly-lines/src/loader.test.ts#L854))

### FR2 — Finish guard in the replay

- `nextTransition()` refuses the `finish` transition while any goal-gated node lacks a success-class outcome, returning a `fail` transition carrying a distinct `goal_gate_unmet` outcome instead; a line with no gates finishes exactly as before ([validated by `transition.test.ts:254`](libs/assembly-lines/src/transition.test.ts#L254), [`transition.test.ts:260`](libs/assembly-lines/src/transition.test.ts#L260), [`transition.test.ts:287`](libs/assembly-lines/src/transition.test.ts#L287))
- A goal-gated node that conditional branching skipped entirely counts as unmet: the line fails with `goal_gate_unmet` rather than finishing around it ([validated by `transition.test.ts:269`](libs/assembly-lines/src/transition.test.ts#L269))
- `changes_requested` satisfies a gate. For a review node it is a completed review that produced a verdict, not a failure — the analogue of Attractor's PARTIAL_SUCCESS ([validated by `transition.test.ts:278`](libs/assembly-lines/src/transition.test.ts#L278))
- Only the gated node's latest visit decides. A gate satisfied on iteration 1 whose re-run failed leaves the line `goal_gate_unmet`, because the earlier verdict applied to an earlier state of the branch; symmetrically, a latest clean visit supersedes an earlier failed one ([validated by `transition.test.ts:341`](libs/assembly-lines/src/transition.test.ts#L341), [`transition.test.ts:353`](libs/assembly-lines/src/transition.test.ts#L353))
- The `goal_gate_unmet` reason names every unsatisfied gate — and only the unsatisfied ones, so a line where one gate passed and another did not points at the one that broke ([validated by `transition.test.ts:406`](libs/assembly-lines/src/transition.test.ts#L406), [`transition.test.ts:462`](libs/assembly-lines/src/transition.test.ts#L462))
- The guard lives in the exit branch, downstream of loop accounting, so a line that exhausts an `iteration_max` budget before ever reaching its gate fails `iteration_max` — the budget is the earlier and more specific diagnosis ([validated by `transition.test.ts:451`](libs/assembly-lines/src/transition.test.ts#L451))

### FR3 — Adoption in the motivating lines

- The `code-review` and `implementation` definitions carry `goal_gate: true` on their review nodes — the motivating use, and the reason this feature exists ([validated by `loader.test.ts:879`](libs/assembly-lines/src/loader.test.ts#L879))
- `implementation.yaml`'s `implement --changes_requested--> retrospective` edge is redirected to `validate`. That edge is the one path reaching exit without review, and short-circuiting to the terminal marker was already wrong on its own terms: the implement node produced code, which belongs in validate → push → review like any other outcome. The edge is redirected rather than removed because an agent node's `changes_requested` is a producible outcome, and an uncovered producible outcome is a hard load error ([validated by `loader.test.ts:867`](libs/assembly-lines/src/loader.test.ts#L867))
- With that edge redirected, every path from entry to exit in both adopted definitions passes through the gated review node, so neither builtin definition raises the FR1 bypass warning. The warning remains fully implemented and tested against synthetic definitions — it exists for the definitions authors write next, not for these two ([validated by `loader.test.ts:879`](libs/assembly-lines/src/loader.test.ts#L879))

### FR4 — Surfacing the new outcome

- The run list and run detail render `goal_gate_unmet` with its own failure-toned label rather than falling through to a neutral unknown-outcome badge ([validated by `assembly-line-presenter.test.ts:98`](apps/web-ui/src/lib/assembly-line-presenter.test.ts#L98))
- `goal_gate_unmet` classifies as a failure outcome, so it rides the existing user-facing failure path (escalation plus PR comment) — a gated line never stops silently ([validated by `notify-failure.test.ts:199`](apps/floor/src/jobs/assembly-line/notify-failure.test.ts#L199), [`notify-failure.test.ts:203`](apps/floor/src/jobs/assembly-line/notify-failure.test.ts#L203))
- A PR-linked line that closes `goal_gate_unmet` publishes a failing `lore/<definition>` check rather than a neutral or green one ([validated by `pr-check.test.ts:190`](apps/floor/src/jobs/assembly-line/pr-check.test.ts#L190))
- The hand-written web-ui mirror of the definition schema carries `goal_gate` — enforced at compile time by `scripts/type-drift/assembly-line-definition.drift.ts`, and visible at runtime in the transcribed builtin definitions the run graph draws ([validated by `run-graph-definition.test.ts:81`](apps/web-ui/src/lib/run-graph-definition.test.ts#L81))

## Alternatives rejected

- **Keep encoding success in topology.** Works until conditional edges are added; the failure mode is a silently green line that skipped its gate, which is exactly the bug this feature exists to close.
- **A line-level `required_nodes` list.** Equivalent power, but the invariant belongs on the node it protects — a separate list drifts the moment a node is renamed.
- **Enforcing in each station.** Stations report outcomes; they must not hold walk-level authority (station contract, ADR-031). A station cannot see the whole line, so it cannot decide the line's success.
- **A new terminal node type.** Would express the same constraint as topology again, reintroducing the readability problem.

## Consequences

- The change is small and pure: a loader schema addition, a load-time reachability warning, and a guard in the replay's finish branch — all in modules that already have colocated tests.
- Definitions become auditable for their success criteria; a recorded run outcome stops being able to misreport a skipped gate as success.
- Behaviour changes on the two adopted lines, and this is the one part of the feature that alters existing production behaviour:
  - `code-review.yaml`: a `review --failed--> done` walk (the review agent crashed, timed out, or its CR failed) closes `goal_gate_unmet` instead of green. Today such a PR receives a passing `lore/code-review` check for a review that never produced a verdict.
  - `implementation.yaml`: the `implement --changes_requested-->` path no longer reaches the terminal marker at all — it now flows through validate → push → review, so the change is actually reviewed instead of closing green unreviewed and unpushed. A `review --failed--> retrospective --> done` walk closes `goal_gate_unmet`.
  - A review that requests changes, is addressed, and passes on re-review still finishes green: the guard reads the gated node's latest visit, so iteration 2's success supersedes iteration 1's `changes_requested`.
- One new terminal outcome reaches the two live consumer surfaces: the run-viz UI and the PR check. The user-facing failure path is `notifyLineFailure` (FR4), not escalation.
- `EscalationReason` also admits `goal_gate_unmet`, but this is a type-level addition only — `escalate()` has no production importer today, so no code path constructs such an escalation. The union is kept exhaustive so that a future caller can name this invariant rather than borrow an unrelated reason; `iteration_max_exceeded` sits in the same unwired union ([validated by `escalation.test.ts:218`](apps/floor/src/jobs/platform/escalation.test.ts#L218))

## Out of Scope

- Gate semantics richer than success-class (e.g. per-gate custom predicates, or requiring a specific outcome value per gate).
- Backfilling `goal_gate` onto definitions beyond the two motivating lines; other lines adopt it when their authors choose to.
- Any change to `stationNodeOutcome()` precedence or the station contract.

## Verification

- `libs/assembly-lines` unit tests cover the loader schema, the exit-node rejection, the bypass warning and its propagation, and every finish-guard branch in `nextTransition()` ([validated by `loader.test.ts:721`](libs/assembly-lines/src/loader.test.ts#L721), [`loader.test.ts:802`](libs/assembly-lines/src/loader.test.ts#L802), [`loader.test.ts:834`](libs/assembly-lines/src/loader.test.ts#L834), [`transition.test.ts:254`](libs/assembly-lines/src/transition.test.ts#L254), [`transition.test.ts:269`](libs/assembly-lines/src/transition.test.ts#L269), [`transition.test.ts:341`](libs/assembly-lines/src/transition.test.ts#L341))
- Floor tests cover failure notification and the PR check for the new outcome; web-ui tests cover the badge label ([validated by `notify-failure.test.ts:203`](apps/floor/src/jobs/assembly-line/notify-failure.test.ts#L203), [`pr-check.test.ts:190`](apps/floor/src/jobs/assembly-line/pr-check.test.ts#L190), [`assembly-line-presenter.test.ts:98`](apps/web-ui/src/lib/assembly-line-presenter.test.ts#L98))
- `npm run typecheck:drift` proves the web-ui mirror stayed in sync ([validated by `run-graph-definition.test.ts:81`](apps/web-ui/src/lib/run-graph-definition.test.ts#L81))
