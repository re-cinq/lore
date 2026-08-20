# Feature Specification: Fork-and-Rerun of Assembly Lines from a Completed Node

| Field   | Value                                   |
|---------|-----------------------------------------|
| Feature | Fork-and-Rerun of Assembly Lines from a Completed Node |
| Branch  | `feat/fork-rerun-from-node`             |
| Status  | Implemented                                   |
| Created | 2026-08-07                              |
| Owner   | Platform Engineering                    |

Fork-and-rerun turns a terminal assembly-line execution into a new one that inherits its green prefix: `start` gains a `resumeFrom: { lineId, nodeId }` variant that copies the source line's node rows through the chosen node under a fresh line id, so the ordinary event-driven walk picks up at the next node instead of re-paying for everything that already succeeded. This specification supersedes ADR-041, which is removed in the same branch.

## Problem Statement

When a line fails at node 5 of 6, the remedies today are retry-the-task —
re-running the whole line and re-paying for the green prefix — or manual
surgery on `pipeline.station_runs`. On a long implementation line
that is tens of minutes and real API spend per debugging cycle, and the
cost scales with exactly the lines where debugging matters most.

The walk's state, however, is already replay-derived. `nextTransition()`
(`libs/assembly-lines/src/transition.ts`) computes the next step purely
from the persisted node rows plus the definition graph; the Floor's
`advanceLine` is only its IO driver. The design consequence, so far
unexploited, is that "resume from node N" is **data manipulation, not
execution-engine work**: copy rows 1..N under a fresh line id, insert the
ordinary `assembly_run.start` event, and the existing walk continues from
where the copy stops. No new executor, no new state machine, no change to
`nextTransition` at all.

Peer systems treat resumability at sub-run granularity as table stakes for
long agent runs — LangGraph ships it as time travel over checkpoints,
Attractor checkpoints after every node — and both reach for it primarily as
a debugging affordance rather than a fault-tolerance one.

## FR1 — The `resumeFrom` start variant

- `AssemblyLinesPort.start` accepts an optional `resumeFrom: { lineId, nodeId }`, mints a fresh per-attempt assembly-line id exactly as a plain start does, and returns it. ([validated by `assembly-lines.test.ts:925`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1177))
- A `resumeFrom` start leaves the source line's own row and node rows untouched — the fork is a new attempt, never an edit of the recorded one. ([validated by `assembly-lines.test.ts:992`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1244))
- `branch` is inherited from the source line, and passing `branch` alongside `resumeFrom` is a validation error rather than a silent override. ([validated by `resume.test.ts:136`](libs/shared/src/project/assembly-runs/resume.test.ts#L137), [`assembly-lines.test.ts:1212`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1464))
- `taskId` is inherited from the source line, and passing `taskId` alongside `resumeFrom` is a validation error on the same grounds. ([validated by `resume.test.ts:146`](libs/shared/src/project/assembly-runs/resume.test.ts#L147), [`assembly-lines.test.ts:1212`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1464))
- `args` are inherited from the source line when omitted and replaced wholesale when supplied, so an operator can inject corrected inputs for the replayed remainder; a legacy source row whose `args` column is NULL forks with `{}`, exactly as a plain start would store. ([validated by `assembly-lines.test.ts:1011`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1263), [`assembly-lines.test.ts:1235`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1493), [`assembly-lines.test.ts:1287`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1545))
- A `resumeFrom` start whose `repo` differs from the source line's is rejected: a fork inherits the source's branch, and a branch means nothing in another repository. ([validated by `resume.test.ts:176`](libs/shared/src/project/assembly-runs/resume.test.ts#L173))
- A `resumeFrom` start whose `definitionName` differs from the source line's is rejected — replaying one definition's node rows against another definition's graph is not a fork. ([validated by `resume.test.ts:186`](libs/shared/src/project/assembly-runs/resume.test.ts#L183))
- The repo-scoped `AssemblyLines` facade passes `resumeFrom` through unchanged, so callers write `project.assemblyLines.start(name, { resumeFrom, definitionHash })`. ([validated by `assembly-lines.test.ts:1316`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1572))

## FR2 — Copy semantics

- The copy runs through the chosen node's **latest completed row inclusive**, so earlier iterations of that node — everything a back-edge produced before it — ride along in visit order. ([validated by `resume.test.ts:75`](libs/shared/src/project/assembly-runs/resume.test.ts#L76), [`resume.test.ts:80`](libs/shared/src/project/assembly-runs/resume.test.ts#L81), [`resume.test.ts:84`](libs/shared/src/project/assembly-runs/resume.test.ts#L85), [`resume.test.ts:90`](libs/shared/src/project/assembly-runs/resume.test.ts#L91), [`resume.test.ts:101`](libs/shared/src/project/assembly-runs/resume.test.ts#L102), [`resume.test.ts:128`](libs/shared/src/project/assembly-runs/resume.test.ts#L129), [`assembly-lines.test.ts:948`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1200), [`assembly-lines.test.ts:1195`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1447))
- Copied rows carry the source row's `outcome`, `commit_sha`, `started_at` and `finished_at` — the inherited prefix keeps the provenance of the run that actually produced it rather than masquerading as fresh work — but never its `agent_cr_name`, which is nulled on copy: the run-viz and cost correlation joins resolve a CR name to the newest matching node row, and an echoed name would steal the source's late-arriving agent-event and cost rows. ([validated by `resume.test.ts:111`](libs/shared/src/project/assembly-runs/resume.test.ts#L112), [`assembly-lines.test.ts:948`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1200), [`assembly-lines.test.ts:1251`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1509))
- A `resumeFrom` naming a node the source line never completed — never visited, or visited and still open — is rejected, because there is no replayable prefix to copy. ([validated by `resume.test.ts:231`](libs/shared/src/project/assembly-runs/resume.test.ts#L228))
- A prefix containing an unfinished row before the cutoff is rejected: an outcome-less row replays as `await`, so copying it would mint a line that can never advance. ([validated by `resume.test.ts:245`](libs/shared/src/project/assembly-runs/resume.test.ts#L242))
- The Postgres adapter writes the line row, the `assembly_run.start` event and every copied node row in ONE data-modifying CTE, exactly as a plain start writes its two, so a fork is never half-created. ([validated by `assembly-lines.test.ts:1179`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1431), [`assembly-lines.test.ts:1195`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1447), [`assembly-lines.test.ts:1251`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1509))
- Validation completes before anything is written; the properties it reads — a terminal line's status, definition name, repo and stamped hash — are immutable once observed, so the read-then-write split introduces no window in which a validated fork becomes invalid. ([validated by `assembly-lines.test.ts:1064`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1316), [`assembly-lines.test.ts:1164`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1416), [`assembly-lines.test.ts:1266`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1524), [`assembly-lines.test.ts:1275`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1533))
- The plain (non-fork) start path is unchanged: same statement, same parameters, no copied-rows CTE, and the double agrees with the adapter on it exactly — both state an explicit null parentage in the `assembly_run.start` event, and neither stores a caller-supplied `definitionHash`, which is a resume input the Floor re-stamps. ([validated by `assembly-lines.test.ts:1299`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1539), [`assembly-lines.test.ts:1347`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1603), [`assembly-lines.test.ts:1361`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1617))

## FR3 — Only terminal lines fork

- A `resumeFrom` whose source line is still `queued` or `running` is refused, naming the status. ([validated by `resume.test.ts:200`](libs/shared/src/project/assembly-runs/resume.test.ts#L197), [`assembly-lines.test.ts:1084`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1336), [`assembly-lines.test.ts:1266`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1524))
- A `resumeFrom` whose source line does not exist is refused. ([validated by `resume.test.ts:170`](libs/shared/src/project/assembly-runs/resume.test.ts#L167))
- Decision: the terminal-source rule is the overlap guard's lesson, not squeamishness — the fork reuses the source's branch, so a live source would put two lines on one working branch and let them race for the same commits.

## FR4 — Definition-drift guard

- Decision: `pipeline.assembly_runs` carries the `blueprint_hash`, `resumed_from_run_id` and `resumed_from_node_id` columns (added by the idempotent migration `0036_assembly_line_fork_columns.sql` under their pre-rename names, renamed by 0040) with a partial index on the parentage pointer — schema evidence, not a unit-test target. No FK on `resumed_from_run_id`: losing a source row must never cascade into the fork that outlived it.
- The hash covers the definition's behaviour, not its prose: two loads of the same definition hash equal regardless of key ordering, a reworded `description` is ignored at every depth, and any change to a node or an edge changes it. Node and edge ORDER participates deliberately — `selectEdge` falls back to the first matching candidate, so reordering two `always` edges out of one node can change the walk. The prose exclusion is a denylist, not an allowlist of semantic fields, so a field added to the loader schema later is hashed by default and the guard over-refuses rather than forking across a change it never learned about. ([validated by `definition-hash.test.ts:22`](libs/assembly-lines/src/definition-hash.test.ts#L22), [`definition-hash.test.ts:26`](libs/assembly-lines/src/definition-hash.test.ts#L26), [`definition-hash.test.ts:30`](libs/assembly-lines/src/definition-hash.test.ts#L30), [`definition-hash.test.ts:47`](libs/assembly-lines/src/definition-hash.test.ts#L47), [`definition-hash.test.ts:64`](libs/assembly-lines/src/definition-hash.test.ts#L64), [`definition-hash.test.ts:75`](libs/assembly-lines/src/definition-hash.test.ts#L75), [`definition-hash.test.ts:86`](libs/assembly-lines/src/definition-hash.test.ts#L86), [`definition-hash.test.ts:95`](libs/assembly-lines/src/definition-hash.test.ts#L95), [`definition-hash.test.ts:112`](libs/assembly-lines/src/definition-hash.test.ts#L112), [`definition-hash.test.ts:129`](libs/assembly-lines/src/definition-hash.test.ts#L129))
- The stamp records the hash only when the row carries none, in the Postgres adapter and the in-memory double alike, so a redelivered start that loads a since-edited definition cannot re-point a run at a graph it never ran. *(Amended 2026-08-14: the same call now stores the cloned graph beside the hash — see FR6.38 in `specs/6-dark-factory/spec.md`. The write-once rule is unchanged and covers both, for exactly this reason; the guard's left-hand side becomes the run's OWN stored graph rather than a hash of a file that may no longer exist.)* ([validated by `assembly-lines.test.ts:846`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1097), [`assembly-lines.test.ts:856`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1108), [`assembly-lines.test.ts:865`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1117), [`assembly-lines.test.ts:875`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1127))
- The Floor's `assembly_run.start` handler stamps the hash once, at the moment the definition resolves, and never overwrites an already-stamped value. ([validated by `start-event-handler.test.ts:215`](apps/floor/src/jobs/assembly-run/start-event-handler.test.ts#L216), [`start-event-handler.test.ts:230`](apps/floor/src/jobs/assembly-run/start-event-handler.test.ts#L249), [`start-event-handler.test.ts:252`](apps/floor/src/jobs/assembly-run/start-event-handler.test.ts#L271))
- A `resumeFrom` start requires the caller to supply the current definition's hash, and rejects a mismatch against the source line's stored hash rather than replaying node rows against a graph that has since changed. ([validated by `resume.test.ts:156`](libs/shared/src/project/assembly-runs/resume.test.ts#L157), [`resume.test.ts:223`](libs/shared/src/project/assembly-runs/resume.test.ts#L220), [`assembly-lines.test.ts:1275`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1533))
- A source line whose stored hash is NULL — every row predating the column — is rejected with a message naming the backfill, an honest limitation preferable to forking across silent definition drift. ([validated by `resume.test.ts:213`](libs/shared/src/project/assembly-runs/resume.test.ts#L210))

## FR5 — Audit trail and walk integration

- The `assembly_run.start` event params carry the fork parentage, so the audit record of *why* a line exists rides with the trigger. ([validated by `assembly-lines.test.ts:1028`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1280), [`assembly-lines.test.ts:1052`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1304), [`assembly-lines.test.ts:1179`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1431))
- The line row itself records `resumed_from_run_id` and `resumed_from_node_id`, because `pipeline.events` rows are pruned once handled and an event alone is not a durable audit substrate. ([validated by `assembly-lines.test.ts:925`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1177), [`assembly-lines.test.ts:1052`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1304), [`assembly-lines.test.ts:1212`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1464))
- The walk needs no change: the Floor's ordinary start handler marks the forked row running and `advanceLine` replays the inherited rows through `nextTransition`, which returns a launch for the successor of the cutoff node. ([validated by `advance.test.ts:953`](apps/floor/src/jobs/assembly-run/advance.test.ts#L769), [`advance.test.ts:972`](apps/floor/src/jobs/assembly-run/advance.test.ts#L788))
- *(retired 2026-08-19 — the branch-overlap guard was replaced by the subject key, specs/6-dark-factory FR6.49)* A fork used to defer as `lease_held` when it landed on a branch another open line already held, which required the guard to measure against the inherited prefix rather than an empty node list. A fork now INHERITS its source's `subject_key`, so it holds exactly the guard its source held and a second run for that subject cannot be started at all. Safe because forking is legal only from a terminal run, so the key is always free. ([validated by a fork takes over the subject of the run it forks from](libs/shared/src/project/assembly-runs/assembly-runs.contract.test.ts#L683))
- *(retired 2026-08-19 — same replacement)* The guard read the prefix count fixed at fork time rather than one recomputed from current rows, because a fork whose walk revisits the node it resumed from (`implementation.yaml` loops `validate` back to `implement`) would otherwise re-arm the guard mid-walk and close a RUNNING fork as `lease_held`. The failure mode is now structurally impossible rather than guarded against: the subject guard is enforced by a unique index when a run is STARTED, so nothing re-evaluates it while a walk is in progress. ([validated by a fork takes over the subject of the run it forks from](libs/shared/src/project/assembly-runs/assembly-runs.contract.test.ts#L683))

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
- Copied rows do *not* reference the source attempt's Agent CR names:
  `agent_cr_name` is nulled on copy. Run-viz ingest and cost attribution
  both correlate by CR name with the newest node row winning, so an echoed
  name would re-point any late-arriving agent-event or cost row from the
  source to the fork — and the window is not theoretical, because the
  event sink is fire-and-forget with retries and the canonical fork
  subject is a *failed* line, whose ingest is the most likely to be
  lagging. The price is that inherited rows carry no pod-log link on the
  fork's run page; the source line, one `resumed_from_run_id` hop away,
  keeps the full history. Safe for the walk and the reaper: every
  inherited row is proven terminal by `resolveResumePrefix`, and only
  open rows are ever read back by CR name.
- A copied row is identifiable to consumers without a per-row flag: a
  fork's inherited rows are exactly its first `inherited_node_count` node
  rows in id order.
- Rows predating the `blueprint_hash` column cannot be forked until
  backfilled. No backfill ships here; the rejection message names the
  column so the operator knows what to fill.

## Out of Scope

- The run-detail "rerun from here" UI affordance. This feature delivers the
  port/facade API and the Floor stamping only; no HTTP route and no UI
  control are added, so today's only caller is a programmatic one.
- Editing inherited node state (outcomes, commit shas) on fork.
- Backfilling `blueprint_hash` for historical rows.
- Forking a line whose definition is not a builtin assembly line (a
  single-CR run record has no graph to replay).
