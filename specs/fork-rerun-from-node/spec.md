# Feature Specification: Fork-and-Rerun of Assembly Lines from a Completed Node

| Field   | Value                                  |
| ------- | -------------------------------------- |
| Feature | Fork-and-Rerun of Assembly Lines from a Completed Node |
| Branch  | (unassigned)                           |
| Status  | Draft                                  |
| Created | 2026-08-07                             |
| Owner   | Platform Engineering                   |

Fork-and-Rerun adds a `resume_from` start variant: a new assembly-line
execution seeded with the completed node rows of a prior execution up to a
chosen node, re-running live from that point.

## Problem Statement

When a line fails at node 5 of 6, the remedies today are retry-the-task
(re-running the whole line, re-paying for the green prefix) or manual
surgery. Yet the walk's state is already replay-derived: `nextTransition()`
computes the next step purely from persisted `pipeline.assembly_line_nodes`
rows plus the definition graph. The design consequence, so far unexploited,
is that "resume from node N" is data manipulation, not execution-engine
work: copy rows 1..N under a fresh line id and let the ordinary walk
continue.

LangGraph ships this as time travel (fork any checkpoint, optionally with
edited state) and treats it as a primary debugging affordance. Attractor
checkpoints after every node for the same reason. Every peer system treats
resumability at sub-run granularity as table stakes for long agent runs.

## Functional Requirements

### FR1 — The `resume_from` start API

- `project.assemblyLines.start(definitionName, { resumeFrom: { lineId,
  nodeId } })` creates the new line row and copies the source line's node
  rows up to and including the named node, in the same atomic CTE as the
  existing start; the `assembly_line.start` event carries the parentage for
  audit.
- When `resumeFrom` is supplied, `branch` and `taskId` are inherited from
  the source line and must not be passed — passing them is a validation
  error; `args` may be overridden to inject updated inputs for the replayed
  portion.

### FR2 — Branch reuse and the live-line refusal

- The fork reuses the source branch only when the source line is terminal
  (failed/finished); forking a live line is refused — the overlap guard's
  lesson.

### FR3 — Definition-drift guard

- `resume_from` requires the stored definition content hash to match, else
  it fails fast with a clear error.
- A migration adds a `definition_hash` column to `pipeline.assembly_lines`,
  populated at start time from the loaded YAML content. Existing rows carry
  `NULL` and are rejected by `resume_from` with a clear message until
  backfilled — an honest limitation, preferable to forking across silent
  definition drift.

### FR4 — UI affordance

- The run detail page gains a "rerun from here" affordance on completed
  nodes (behind admin scope).
- Copied rows reference the source attempt's Agent CR names and stage
  commits; consumers (run-viz, timeline) render inherited rows as inherited
  rather than as fresh executions.

## Alternatives rejected

- **Whole-line retry only.** Current state; the cost of the green prefix
  scales with exactly the lines (long, expensive) where debugging matters
  most.
- **Mutating the failed line in place.** Violates per-attempt identity
  (migration 0025's uuid-per-execution design) and corrupts audit history.
- **Editing node state on fork (LangGraph-style state surgery).** Powerful
  but invites unauditable hand-modified runs feeding auto-merge; excluded
  from scope until a concrete need survives review.

## Consequences

- Modest change concentrated in the start API plus one UI affordance; the
  walk itself is untouched — which is the point of the replay design.
- Failed-line diagnosis stops costing full reruns; operators can bisect a
  flaky node cheaply.
