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

- `AssemblyLinesPort.start` accepts an optional `resumeFrom: { lineId, nodeId }`, mints a fresh per-attempt assembly-line id exactly as a plain start does, and returns it. ([validated by `assembly-lines.test.ts:879`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L879))
- A `resumeFrom` start leaves the source line's own row and node rows untouched — the fork is a new attempt, never an edit of the recorded one. ([validated by `assembly-lines.test.ts:946`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L946))
- `branch` is inherited from the source line, and passing `branch` alongside `resumeFrom` is a validation error rather than a silent override. ([validated by `resume.test.ts:135`](libs/shared/src/project/assembly-lines/resume.test.ts#L135), [`assembly-lines.test.ts:1165`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1165))
- `taskId` is inherited from the source line, and passing `taskId` alongside `resumeFrom` is a validation error on the same grounds. ([validated by `resume.test.ts:145`](libs/shared/src/project/assembly-lines/resume.test.ts#L145), [`assembly-lines.test.ts:1165`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1165))
- `args` are inherited from the source line when omitted and replaced wholesale when supplied, so an operator can inject corrected inputs for the replayed remainder. ([validated by `assembly-lines.test.ts:965`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L965), [`assembly-lines.test.ts:1187`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1187))
- A `resumeFrom` start whose `repo` differs from the source line's is rejected: a fork inherits the source's branch, and a branch means nothing in another repository. ([validated by `resume.test.ts:175`](libs/shared/src/project/assembly-lines/resume.test.ts#L175))
- A `resumeFrom` start whose `definitionName` differs from the source line's is rejected — replaying one definition's node rows against another definition's graph is not a fork. ([validated by `resume.test.ts:185`](libs/shared/src/project/assembly-lines/resume.test.ts#L185))
- The repo-scoped `AssemblyLines` facade passes `resumeFrom` through unchanged, so callers write `project.assemblyLines.start(name, { resumeFrom, definitionHash })`. ([validated by `assembly-lines.test.ts:1256`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1256))

## FR2 — Copy semantics

- The copy runs through the chosen node's **latest completed row inclusive**, so earlier iterations of that node — everything a back-edge produced before it — ride along in visit order. ([validated by `resume.test.ts:74`](libs/shared/src/project/assembly-lines/resume.test.ts#L74), [`resume.test.ts:79`](libs/shared/src/project/assembly-lines/resume.test.ts#L79), [`resume.test.ts:83`](libs/shared/src/project/assembly-lines/resume.test.ts#L83), [`resume.test.ts:89`](libs/shared/src/project/assembly-lines/resume.test.ts#L89), [`resume.test.ts:100`](libs/shared/src/project/assembly-lines/resume.test.ts#L100), [`resume.test.ts:127`](libs/shared/src/project/assembly-lines/resume.test.ts#L127), [`assembly-lines.test.ts:902`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L902), [`assembly-lines.test.ts:1148`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1148))
- Copied rows carry the source row's `outcome`, `agent_cr_name`, `commit_sha`, `started_at` and `finished_at`, so the inherited prefix keeps the provenance of the run that actually produced it (its pods, its stage commits) rather than masquerading as fresh work. ([validated by `resume.test.ts:110`](libs/shared/src/project/assembly-lines/resume.test.ts#L110), [`assembly-lines.test.ts:902`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L902), [`assembly-lines.test.ts:1203`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1203))
- A `resumeFrom` naming a node the source line never completed — never visited, or visited and still open — is rejected, because there is no replayable prefix to copy. ([validated by `resume.test.ts:230`](libs/shared/src/project/assembly-lines/resume.test.ts#L230))
- A prefix containing an unfinished row before the cutoff is rejected: an outcome-less row replays as `await`, so copying it would mint a line that can never advance. ([validated by `resume.test.ts:244`](libs/shared/src/project/assembly-lines/resume.test.ts#L244))
- The Postgres adapter writes the line row, the `assembly_line.start` event and every copied node row in ONE data-modifying CTE, exactly as a plain start writes its two, so a fork is never half-created. ([validated by `assembly-lines.test.ts:1132`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1132), [`assembly-lines.test.ts:1148`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1148), [`assembly-lines.test.ts:1203`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1203))
- Validation completes before anything is written; the properties it reads — a terminal line's status, definition name, repo and stamped hash — are immutable once observed, so the read-then-write split introduces no window in which a validated fork becomes invalid. ([validated by `assembly-lines.test.ts:1018`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1018), [`assembly-lines.test.ts:1117`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1117), [`assembly-lines.test.ts:1218`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1218), [`assembly-lines.test.ts:1227`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1227))
- The plain (non-fork) start path is unchanged: same statement, same parameters, no copied-rows CTE. ([validated by `assembly-lines.test.ts:1239`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1239))

## FR3 — Only terminal lines fork

- A `resumeFrom` whose source line is still `queued` or `running` is refused, naming the status. ([validated by `resume.test.ts:199`](libs/shared/src/project/assembly-lines/resume.test.ts#L199), [`assembly-lines.test.ts:1038`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1038), [`assembly-lines.test.ts:1218`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1218))
- A `resumeFrom` whose source line does not exist is refused. ([validated by `resume.test.ts:169`](libs/shared/src/project/assembly-lines/resume.test.ts#L169))
- Decision: the terminal-source rule is the overlap guard's lesson, not squeamishness — the fork reuses the source's branch, so a live source would put two lines on one working branch and let them race for the same commits.

## FR4 — Definition-drift guard

- Decision: `pipeline.assembly_lines` carries the `definition_hash`, `resumed_from_line_id` and `resumed_from_node_id` columns, added by the idempotent migration `0036_assembly_line_fork_columns.sql` with a partial index on the parentage pointer — schema evidence, not a unit-test target. No FK on `resumed_from_line_id`: losing a source row must never cascade into the fork that outlived it.
- The hash is a stable content hash of the definition's semantics: two loads of the same definition hash equal regardless of key ordering, and any change to a node or an edge changes it. ([validated by `definition-hash.test.ts:22`](libs/assembly-lines/src/definition-hash.test.ts#L22), [`definition-hash.test.ts:26`](libs/assembly-lines/src/definition-hash.test.ts#L26), [`definition-hash.test.ts:30`](libs/assembly-lines/src/definition-hash.test.ts#L30), [`definition-hash.test.ts:47`](libs/assembly-lines/src/definition-hash.test.ts#L47), [`definition-hash.test.ts:64`](libs/assembly-lines/src/definition-hash.test.ts#L64), [`definition-hash.test.ts:75`](libs/assembly-lines/src/definition-hash.test.ts#L75), [`definition-hash.test.ts:86`](libs/assembly-lines/src/definition-hash.test.ts#L86), [`definition-hash.test.ts:95`](libs/assembly-lines/src/definition-hash.test.ts#L95))
- `stampDefinitionHash` records the hash only when the row carries none, in the Postgres adapter and the in-memory double alike, so a redelivered start that loads a since-edited definition cannot re-point a line at a graph it never ran. ([validated by `assembly-lines.test.ts:800`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L800), [`assembly-lines.test.ts:810`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L810), [`assembly-lines.test.ts:819`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L819), [`assembly-lines.test.ts:829`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L829))
- The Floor's `assembly_line.start` handler stamps the hash once, at the moment the definition resolves, and never overwrites an already-stamped value. ([validated by `start-event-handler.test.ts:215`](apps/floor/src/jobs/assembly-line/start-event-handler.test.ts#L215), [`start-event-handler.test.ts:230`](apps/floor/src/jobs/assembly-line/start-event-handler.test.ts#L230), [`start-event-handler.test.ts:252`](apps/floor/src/jobs/assembly-line/start-event-handler.test.ts#L252))
- A `resumeFrom` start requires the caller to supply the current definition's hash, and rejects a mismatch against the source line's stored hash rather than replaying node rows against a graph that has since changed. ([validated by `resume.test.ts:155`](libs/shared/src/project/assembly-lines/resume.test.ts#L155), [`resume.test.ts:222`](libs/shared/src/project/assembly-lines/resume.test.ts#L222), [`assembly-lines.test.ts:1227`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1227))
- A source line whose stored hash is NULL — every row predating the column — is rejected with a message naming the backfill, an honest limitation preferable to forking across silent definition drift. ([validated by `resume.test.ts:212`](libs/shared/src/project/assembly-lines/resume.test.ts#L212))

## FR5 — Audit trail and walk integration

- The `assembly_line.start` event params carry the fork parentage, so the audit record of *why* a line exists rides with the trigger. ([validated by `assembly-lines.test.ts:982`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L982), [`assembly-lines.test.ts:1006`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1006), [`assembly-lines.test.ts:1132`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1132))
- The line row itself records `resumed_from_line_id` and `resumed_from_node_id`, because `pipeline.events` rows are pruned once handled and an event alone is not a durable audit substrate. ([validated by `assembly-lines.test.ts:879`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L879), [`assembly-lines.test.ts:1006`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1006), [`assembly-lines.test.ts:1165`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1165))
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
