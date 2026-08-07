# Feature Specification: Fork-and-Rerun of Assembly Lines from a Completed Node

| Field   | Value                                   |
|---------|-----------------------------------------|
| Feature | Fork-and-Rerun of Assembly Lines from a Completed Node |
| Branch  | `feat/fork-rerun-from-node`             |
| Status  | In Progress                                 |
| Created | 2026-08-07                              |
| Owner   | Platform Engineering                    |

Fork-and-rerun turns a terminal assembly-line execution into a new one that inherits its green prefix: `start` gains a `resumeFrom: { lineId, nodeId }` variant that copies the source line's node rows through the chosen node under a fresh line id, so the ordinary event-driven walk picks up at the next node instead of re-paying for everything that already succeeded. This specification supersedes ADR-041, which is removed in the same branch.

## Problem Statement

When a line fails at node 5 of 6, the remedies today are retry-the-task —
re-running the whole line and re-paying for the green prefix — or manual
surgery on `pipeline.assembly_line_nodes`. On a long implementation line
that is tens of minutes and real API spend per debugging cycle, and the
cost scales with exactly the lines where debugging matters most.

The walk's state, however, is already replay-derived. `nextTransition()`
(`libs/assembly-lines/src/transition.ts`) computes the next step purely
from the persisted node rows plus the definition graph; the Floor's
`advanceLine` is only its IO driver. The design consequence, so far
unexploited, is that "resume from node N" is **data manipulation, not
execution-engine work**: copy rows 1..N under a fresh line id, insert the
ordinary `assembly_line.start` event, and the existing walk continues from
where the copy stops. No new executor, no new state machine, no change to
`nextTransition` at all.

Peer systems treat resumability at sub-run granularity as table stakes for
long agent runs — LangGraph ships it as time travel over checkpoints,
Attractor checkpoints after every node — and both reach for it primarily as
a debugging affordance rather than a fault-tolerance one.

## FR1 — The `resumeFrom` start variant

- `AssemblyLinesPort.start` accepts an optional `resumeFrom: { lineId, nodeId }`, mints a fresh per-attempt assembly-line id exactly as a plain start does, and returns it.
- A `resumeFrom` start leaves the source line's own row and node rows untouched — the fork is a new attempt, never an edit of the recorded one.
- `branch` is inherited from the source line, and passing `branch` alongside `resumeFrom` is a validation error rather than a silent override.
- `taskId` is inherited from the source line, and passing `taskId` alongside `resumeFrom` is a validation error on the same grounds.
- `args` are inherited from the source line when omitted and replaced wholesale when supplied, so an operator can inject corrected inputs for the replayed remainder.
- A `resumeFrom` start whose `repo` differs from the source line's is rejected: a fork inherits the source's branch, and a branch means nothing in another repository.
- A `resumeFrom` start whose `definitionName` differs from the source line's is rejected — replaying one definition's node rows against another definition's graph is not a fork.
- The repo-scoped `AssemblyLines` facade passes `resumeFrom` through unchanged, so callers write `project.assemblyLines.start(name, { resumeFrom, definitionHash })`.

## FR2 — Copy semantics

- The copy runs through the chosen node's **latest completed row inclusive**, so earlier iterations of that node — everything a back-edge produced before it — ride along in visit order.
- Copied rows carry the source row's `outcome`, `agent_cr_name`, `commit_sha`, `started_at` and `finished_at`, so the inherited prefix keeps the provenance of the run that actually produced it (its pods, its stage commits) rather than masquerading as fresh work.
- A `resumeFrom` naming a node the source line never completed — never visited, or visited and still open — is rejected, because there is no replayable prefix to copy.
- A prefix containing an unfinished row before the cutoff is rejected: an outcome-less row replays as `await`, so copying it would mint a line that can never advance.
- The Postgres adapter writes the line row, the `assembly_line.start` event and every copied node row in ONE data-modifying CTE, exactly as a plain start writes its two, so a fork is never half-created.
- Validation completes before anything is written; the properties it reads — a terminal line's status, definition name, repo and stamped hash — are immutable once observed, so the read-then-write split introduces no window in which a validated fork becomes invalid.
- The plain (non-fork) start path is unchanged: same statement, same parameters, no copied-rows CTE.

## FR3 — Only terminal lines fork

- A `resumeFrom` whose source line is still `queued` or `running` is refused, naming the status.
- A `resumeFrom` whose source line does not exist is refused.
- Decision: the terminal-source rule is the overlap guard's lesson, not squeamishness — the fork reuses the source's branch, so a live source would put two lines on one working branch and let them race for the same commits.

## FR4 — Definition-drift guard

- `pipeline.assembly_lines` carries a `definition_hash` column holding a content hash of the definition the execution ran.
- The hash is a stable content hash of the definition's semantics: two loads of the same definition hash equal regardless of key ordering, and any change to a node or an edge changes it. ([validated by `definition-hash.test.ts:22`](libs/assembly-lines/src/definition-hash.test.ts#L22), [`definition-hash.test.ts:26`](libs/assembly-lines/src/definition-hash.test.ts#L26), [`definition-hash.test.ts:30`](libs/assembly-lines/src/definition-hash.test.ts#L30), [`definition-hash.test.ts:47`](libs/assembly-lines/src/definition-hash.test.ts#L47), [`definition-hash.test.ts:64`](libs/assembly-lines/src/definition-hash.test.ts#L64), [`definition-hash.test.ts:75`](libs/assembly-lines/src/definition-hash.test.ts#L75), [`definition-hash.test.ts:86`](libs/assembly-lines/src/definition-hash.test.ts#L86), [`definition-hash.test.ts:95`](libs/assembly-lines/src/definition-hash.test.ts#L95))
- The Floor's `assembly_line.start` handler stamps the hash once, at the moment the definition resolves, and never overwrites an already-stamped value.
- A `resumeFrom` start requires the caller to supply the current definition's hash, and rejects a mismatch against the source line's stored hash rather than replaying node rows against a graph that has since changed.
- A source line whose stored hash is NULL — every row predating the column — is rejected with a message naming the backfill, an honest limitation preferable to forking across silent definition drift.

## FR5 — Audit trail and walk integration

- The `assembly_line.start` event params carry the fork parentage, so the audit record of *why* a line exists rides with the trigger.
- The line row itself records `resumed_from_line_id` and `resumed_from_node_id`, because `pipeline.events` rows are pruned once handled and an event alone is not a durable audit substrate.
- The walk needs no change: the Floor's ordinary start handler marks the forked row running and `advanceLine` replays the inherited rows through `nextTransition`, which returns a launch for the successor of the cutoff node.
- The branch-overlap guard counts the inherited prefix rather than an empty node list, so a fork that lands on a branch another open line already holds still defers as `lease_held` instead of racing it.

## Alternatives rejected

- **Whole-line retry only.** The status quo. The cost of re-running the
  green prefix scales with exactly the lines — long, expensive,
  many-noded — where iterative debugging is most valuable.
- **Mutating the failed line in place.** Violates the per-attempt identity
  that migration 0025 deliberately established (a uuid per execution, not
  per task) and destroys the audit history of what the failed attempt did.
- **Editing node state on fork (LangGraph-style state surgery).** Powerful,
  and explicitly out of scope: hand-modified runs feeding auto-merge is an
  unauditable path to a merged commit. `args` replacement is the bounded
  version of the same affordance.
- **Hashing the raw YAML bytes.** Rejected in favour of hashing the parsed
  definition: a comment or reflow would otherwise read as drift and block
  every fork of every prior run.
- **Deriving the current hash inside the port.** `libs/shared` cannot import
  `libs/assembly-lines` (the dependency runs the other way), so the caller
  supplies the hash it loaded. This also keeps the port free of YAML IO.

## Consequences

- The change is concentrated in the start API plus one Floor stamping call;
  `nextTransition` and the walk are untouched, which is the point of the
  replay design.
- Failed-line diagnosis stops costing a full rerun. An operator can bisect
  a flaky node by forking repeatedly from the node before it.
- Copied rows reference the source attempt's Agent CR names. Run-viz
  correlates agent events to node rows by CR name, newest row wins, so an
  agent event arriving for a source CR *after* a fork exists would correlate
  to the fork's copied row. Only terminal lines fork and their pods are
  gone, so the window is theoretical; the alternative — nulling the CR name
  on copy — would cost the inherited rows their link to the logs that
  produced them.
- A copied row is identifiable to consumers without a dedicated flag: its
  `agent_cr_name` is prefixed with the *source* line's id, not its own.
- Rows predating the `definition_hash` column cannot be forked until
  backfilled. No backfill ships here; the rejection message names the
  column so the operator knows what to fill.

## Out of Scope

- The run-detail "rerun from here" UI affordance. This feature delivers the
  port/facade API and the Floor stamping only; no HTTP route and no UI
  control are added, so today's only caller is a programmatic one.
- Editing inherited node state (outcomes, commit shas) on fork.
- Backfilling `definition_hash` for historical rows.
- Forking a line whose definition is not a builtin assembly line (a
  single-CR run record has no graph to replay).
