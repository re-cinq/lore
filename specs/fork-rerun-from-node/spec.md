# Feature Specification: Fork-and-Rerun of Assembly Lines from a Completed Node

| Field   | Value                                                  |
| ------- | ------------------------------------------------------ |
| Feature | Fork-and-Rerun of Assembly Lines from a Completed Node |
| Branch  | docs/convert-field-survey-adrs-to-specs                |
| Status  | Shipped                                                |
| Created | 2026-08-07                                             |
| Owner   | Platform Engineering                                   |

Fork-and-Rerun adds a `resumeFrom` start variant: a new assembly-line
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

### FR1 — The `resumeFrom` start API

- `assemblyLines.start({ resumeFrom: { lineId, nodeId } })` creates the new line row and copies the source line's node rows — node id, iteration, outcome, agent CR name, stage-commit sha — up to and including the named node, under a fresh assembly-line id. ([validated by `assembly-lines.test.ts:839`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L839))
- In the Pg adapter the copy rides the same atomic data-modifying CTE as the plain start (line row + start event + node-row copies in one statement), and validation happens before anything is written. ([validated by `assembly-lines.test.ts:1121`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1121), [`assembly-lines.test.ts:1145`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1145))
- When the chosen node ran several iterations, the copy runs through its latest completed row, so every earlier visit — including the node's own prior iterations — rides along and the replay continues after its recorded outcome. ([validated by `assembly-lines.test.ts:866`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L866))
- The `assembly_line.start` event carries the fork parentage (`resumedFrom: { lineId, nodeId }`) for audit. ([validated by `assembly-lines.test.ts:1025`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1025))
- A node with no completed row on the source line cannot be a fork point. ([validated by `assembly-lines.test.ts:1011`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1011))

### FR2 — Inheritance and the live-line refusal

- `branch` and `taskId` are inherited from the source line and must not be passed — passing either is a validation error; `args` may be overridden to inject updated inputs for the replayed portion, and is inherited otherwise. ([validated by `assembly-lines.test.ts:907`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L907), [`assembly-lines.test.ts:925`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L925), [`assembly-lines.test.ts:943`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L943))
- The fork reuses the source branch only when the source line is terminal (finished/failed); forking a live line is refused — the overlap guard's lesson. ([validated by `assembly-lines.test.ts:969`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L969))

### FR3 — Definition-drift guard

- Every execution row stores a content hash of the loaded definition (`definition_hash`, migration 0036); the hash is deterministic for an unchanged definition and moves on any edit. ([validated by `loader.test.ts:765`](libs/assembly-lines/src/loader.test.ts#L765))
- The walk's start handler stamps the hash when the definition resolves — once, never overwriting, and leaving single-CR rows (no builtin definition) unstamped. ([validated by `start-event-handler.test.ts:212`](apps/floor/src/jobs/assembly-line/start-event-handler.test.ts#L212), [`start-event-handler.test.ts:225`](apps/floor/src/jobs/assembly-line/start-event-handler.test.ts#L225), [`assembly-lines.test.ts:1045`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1045), [`assembly-lines.test.ts:1059`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1059))
- `resumeFrom` requires the stored hash to match the current definition's hash, else it fails fast with a clear error. ([validated by `assembly-lines.test.ts:997`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L997))
- Rows predating the hash column carry `NULL` and are rejected with a clear backfill message — an honest limitation, preferable to forking across silent definition drift. ([validated by `assembly-lines.test.ts:983`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L983))

## Out of scope (follow-up)

- The run detail page's "rerun from here" affordance on completed nodes
  (behind admin scope), and rendering inherited rows as inherited rather
  than fresh executions in run-viz and the timeline. The API ships first;
  the UI follows once it has a consumer to design against.
- Editing node state on fork (LangGraph-style state surgery) — excluded
  until a concrete need survives review; hand-modified runs feeding
  auto-merge would be unauditable.

## Alternatives rejected

- **Whole-line retry only.** Current state; the cost of the green prefix
  scales with exactly the lines (long, expensive) where debugging matters
  most.
- **Mutating the failed line in place.** Violates per-attempt identity
  (migration 0025's uuid-per-execution design) and corrupts audit history.

## Consequences

- Modest change concentrated in the start API plus the hash stamp in the
  start handler; the walk itself is untouched — which is the point of the
  replay design.
- Failed-line diagnosis stops costing full reruns; operators can bisect a
  flaky node cheaply.
