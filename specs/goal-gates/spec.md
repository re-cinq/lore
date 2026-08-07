# Feature Specification: Declarative Goal Gates in Assembly-Line Definitions

| Field   | Value                                  |
| ------- | -------------------------------------- |
| Feature | Declarative Goal Gates in Assembly-Line Definitions |
| Branch  | (unassigned)                           |
| Status  | Draft                                  |
| Created | 2026-08-07                             |
| Owner   | Platform Engineering                   |

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

- `libs/assembly-lines/src/loader.ts` accepts an optional `goal_gate: true`
  on any node.
- Existing definitions are unchanged: the attribute is opt-in.
- The loader emits a validation warning when a goal-gated node is reachable
  only through conditional edges, so the definition author learns at load
  time, not at the first skipped run.

### FR2 — Finish guard in the replay

- `nextTransition()` refuses the finish transition while any goal-gated node
  in the walked graph lacks a success-class outcome, failing the line with a
  distinct `goal_gate_unmet` outcome instead of finishing it.
- A goal-gated node skipped by conditional branching still counts as unmet:
  the line fails with `goal_gate_unmet` rather than finishing around it.
  Gates therefore belong on unconditionally-reachable nodes.

### FR3 — Adoption in the motivating lines

- The code-review and implementation lines adopt `goal_gate: true` on their
  review nodes in the same change, as the motivating use.

### FR4 — Surfacing the new outcome

- The new terminal outcome (`goal_gate_unmet`) reaches the run-viz UI and
  `pipeline.audit_log` consumers; both get the label added.
- `goal_gate_unmet` routes through the same `escalate()` path as other
  terminal failures — a `needs-human-help` issue on the target repo listing
  the unsatisfied gate(s) in the diagnostic. No new escalation mechanism;
  the existing call in the walk's fail branch covers it, so gated lines
  never stop silently.

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
- Definitions become auditable for their success criteria; the status of a
  run stops being able to misreport a skipped gate as success.
