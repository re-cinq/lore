# Feature Specification: Declarative Goal Gates in Assembly-Line Definitions

| Field   | Value                                               |
| ------- | --------------------------------------------------- |
| Feature | Declarative Goal Gates in Assembly-Line Definitions |
| Branch  | docs/convert-field-survey-adrs-to-specs             |
| Status  | Shipped                                             |
| Created | 2026-08-07                                          |
| Owner   | Platform Engineering                                |

Goal Gates add a `goal_gate: true` node attribute to assembly-line YAML: a
line may not reach its terminal success state unless every goal-gated node
recorded a successful outcome. The invariant lives in the definition, where
reviewers of a definition change can see it, not in the topology's
implications.

## Problem Statement

Whether a line "succeeded" is currently implicit in graph shape and
code-side outcome precedence (`stationNodeOutcome()`, edge selection in
`nextTransition()`). A definition author who wants "this line does not count
as done unless review passed" must express it by wiring edges so no path
reaches the terminal node without the review node — easy to get wrong when
definitions grow conditional branches, and invisible to a reader auditing
the YAML.

StrongDM's Attractor spec models this as a first-class `goal_gate` node
attribute: exit is refused until every gated node reached SUCCESS (or
PARTIAL_SUCCESS).

## Functional Requirements

### FR1 — Loader schema

- The loader accepts an optional `goal_gate: true` on any node; the attribute is opt-in and existing definitions parse unchanged. ([validated by `loader.test.ts:706`](libs/assembly-lines/src/loader.test.ts#L706))
- The loader surfaces a validation warning when a goal-gated node can be bypassed on a path from entry to exit, so the definition author learns at load time — not at the first skipped run — that the gate can fail the line via a skip. ([validated by `loader.test.ts:712`](libs/assembly-lines/src/loader.test.ts#L712))
- No warning is raised when every path to exit passes through the gated node. ([validated by `loader.test.ts:721`](libs/assembly-lines/src/loader.test.ts#L721))
- The warning reaches the loading callers, not just direct `parseAssemblyLine` users: the file and directory loaders forward it, and the builtin loader reports implementation.yaml's bypassable review gate. ([validated by `loader.test.ts:795`](libs/assembly-lines/src/loader.test.ts#L795), [`loader.test.ts:807`](libs/assembly-lines/src/loader.test.ts#L807))
- With no handler supplied, the builtin loader logs bypass warnings through `console.warn`, so a bypassable gate is visible at server startup rather than silently swallowed. ([validated by `loader.test.ts:819`](libs/assembly-lines/src/loader.test.ts#L819))

### FR2 — Finish guard in the replay

- `nextTransition()` refuses the finish transition while any goal-gated node lacks a success-class outcome, failing the line with a distinct `goal_gate_unmet` outcome instead of finishing it. ([validated by `transition.test.ts:255`](libs/assembly-lines/src/transition.test.ts#L255), [`transition.test.ts:267`](libs/assembly-lines/src/transition.test.ts#L267))
- A goal-gated node skipped by conditional branching still counts as unmet: the line fails with `goal_gate_unmet` rather than finishing around it. ([validated by `transition.test.ts:244`](libs/assembly-lines/src/transition.test.ts#L244))
- `changes_requested` satisfies a gate: for a review node it is a completed review with a verdict, not a failure — the Attractor PARTIAL_SUCCESS analogue. ([validated by `transition.test.ts:276`](libs/assembly-lines/src/transition.test.ts#L276))
- The `goal_gate_unmet` failure reason names every unsatisfied gate, so the escalation diagnostic tells the operator exactly which invariant broke. ([validated by `transition.test.ts:285`](libs/assembly-lines/src/transition.test.ts#L285))

### FR3 — Adoption in the motivating lines

- The code-review and implementation lines carry `goal_gate: true` on their review nodes, as the motivating use: a line that skipped or failed its review can no longer read as green. ([validated by `loader.test.ts:754`](libs/assembly-lines/src/loader.test.ts#L754))

### FR4 — Surfacing the new outcome

- The run list and run detail render `goal_gate_unmet` with its own danger-tone label rather than falling through to a neutral unknown-outcome badge. ([validated by `assembly-line-presenter.test.ts:98`](apps/web-ui/src/lib/assembly-line-presenter.test.ts#L98))
- `goal_gate_unmet` classifies as a failure outcome, so it rides the same user-facing failure-notification path (Slack escalation + PR comment, `finishLine`'s winner-only seam) as every other terminal failure — gated lines never stop silently. ([validated by `notify-failure.test.ts:200`](apps/floor/src/jobs/assembly-line/notify-failure.test.ts#L200))
- A PR-linked line that closes `goal_gate_unmet` publishes a failing `lore/<definition>` check, not a neutral or green one. ([validated by `pr-check.test.ts:191`](apps/floor/src/jobs/assembly-line/pr-check.test.ts#L191))

## Alternatives rejected

- **Keep encoding success in topology.** Works until conditional edges are
  added; the failure mode is a silently green line that skipped its gate.
- **A line-level `required_nodes` list.** Same power, but the invariant
  belongs on the node it protects; a separate list drifts when nodes are
  renamed.
- **Enforcing in each station.** Stations report outcomes; they must not
  hold walk-level authority (station contract, ADR-031).

## Consequences

- Small, pure change to the loader schema and the replay's finish guard,
  both already colocated with tests.
- Definitions become auditable for their success criteria; a run's recorded
  outcome stops being able to misreport a skipped gate as success.
- Behavior change on the adopted lines: the implementation line's
  `implement → retrospective` path on `changes_requested` (which skips
  review) and its `review failed` path now close the line as
  `goal_gate_unmet` instead of a finished success — that is the point.
