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

- `AssemblyLinesPort.start` accepts an optional `resumeFrom: { lineId, nodeId }`, mints a fresh per-attempt assembly-line id exactly as a plain start does, and returns it. ([validated by `assembly-lines.test.ts:1195`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1180))
- A `resumeFrom` start leaves the source line's own row and node rows untouched — the fork is a new attempt, never an edit of the recorded one. ([validated by `assembly-lines.test.ts:1262`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1265))
- `branch` is inherited from the source line, and passing `branch` alongside `resumeFrom` is a validation error rather than a silent override. ([validated by `resume.test.ts:180`](libs/shared/src/project/assembly-runs/resume.test.ts#L180), [`assembly-lines.test.ts:1482`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1484))
- `taskId` is inherited from the source line, and passing `taskId` alongside `resumeFrom` is a validation error on the same grounds. ([validated by `resume.test.ts:190`](libs/shared/src/project/assembly-runs/resume.test.ts#L190), [`assembly-lines.test.ts:1482`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1484))
- `args` are inherited from the source line when omitted and replaced wholesale when supplied, so an operator can inject corrected inputs for the replayed remainder; a legacy source row whose `args` column is NULL forks with `{}`, exactly as a plain start would store. ([validated by `assembly-lines.test.ts:1281`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1284), [`assembly-lines.test.ts:1511`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1510), [`assembly-lines.test.ts:1572`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1563))
- A `resumeFrom` start whose `repo` differs from the source line's is rejected: a fork inherits the source's branch, and a branch means nothing in another repository. ([validated by `resume.test.ts:216`](libs/shared/src/project/assembly-runs/resume.test.ts#L216))
- A `resumeFrom` start whose `definitionName` differs from the source line's is rejected — replaying one definition's node rows against another definition's graph is not a fork. ([validated by `resume.test.ts:226`](libs/shared/src/project/assembly-runs/resume.test.ts#L226))
- The repo-scoped `AssemblyLines` facade passes `resumeFrom` through unchanged, so callers write `project.assemblyLines.start(name, { resumeFrom, definitionHash })`. ([validated by `assembly-lines.test.ts:1599`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1590))

## FR2 — Copy semantics

- The copy runs through the chosen node's **latest completed row inclusive**, so earlier iterations of that node — everything a back-edge produced before it — ride along in visit order. ([validated by `resume.test.ts:75`](libs/shared/src/project/assembly-runs/resume.test.ts#L87), [`resume.test.ts:92`](libs/shared/src/project/assembly-runs/resume.test.ts#L92), [`resume.test.ts:96`](libs/shared/src/project/assembly-runs/resume.test.ts#L96), [`resume.test.ts:102`](libs/shared/src/project/assembly-runs/resume.test.ts#L102), [`resume.test.ts:129`](libs/shared/src/project/assembly-runs/resume.test.ts#L129), [`resume.test.ts:156`](libs/shared/src/project/assembly-runs/resume.test.ts#L156), [`assembly-lines.test.ts:1218`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1203), [`assembly-lines.test.ts:1465`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1468))
- Copied rows carry the source row's `outcome`, `commit_sha`, `started_at` and `finished_at` — the inherited prefix keeps the provenance of the run that actually produced it rather than masquerading as fresh work — but never its `agent_cr_name`, which is nulled on copy: the run-viz and cost correlation joins resolve a CR name to the newest matching node row, and an echoed name would steal the source's late-arriving agent-event and cost rows. ([validated by `resume.test.ts:111`](libs/shared/src/project/assembly-runs/resume.test.ts#L139), [`assembly-lines.test.ts:1218`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1203), [`assembly-lines.test.ts:1527`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1526))
- A `resumeFrom` naming a node the source line never completed — never visited, or visited and still open — is rejected, because there is no replayable prefix to copy. ([validated by `resume.test.ts:305`](libs/shared/src/project/assembly-runs/resume.test.ts#L305))
- *(amended 2026-09-02)* `resumeFrom` MAY name an `iteration`, and the copy then runs through exactly that completed visit instead of the node's latest row. This is what makes a LOOP retry expressible: on a line with back-edges, the node before the retry target can have run again later — or BE the target, on a self-edge, where cutting at the latest row would copy the failed visit itself and the fork's replay would re-derive the spent `iteration_max` as a fork dead on arrival. A named iteration the source never completed, or one still open, is rejected on the same no-replayable-prefix grounds. ([validated by names the exact visit when an iteration is given](libs/shared/src/project/assembly-runs/resume.test.ts#L111), [`resume.test.ts:117`](libs/shared/src/project/assembly-runs/resume.test.ts#L117), [`resume.test.ts:121`](libs/shared/src/project/assembly-runs/resume.test.ts#L121), [`resume.test.ts:271`](libs/shared/src/project/assembly-runs/resume.test.ts#L271), [`resume.test.ts:289`](libs/shared/src/project/assembly-runs/resume.test.ts#L289), [`assembly-runs.test.ts:1247`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1247))
- A prefix containing an unfinished row before the cutoff is rejected: an outcome-less row replays as `await`, so copying it would mint a line that can never advance. ([validated by `resume.test.ts:319`](libs/shared/src/project/assembly-runs/resume.test.ts#L319))
- The Postgres adapter writes the line row, the `assembly_run.start` event and every copied node row in ONE data-modifying CTE, exactly as a plain start writes its two, so a fork is never half-created. ([validated by `assembly-lines.test.ts:1449`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1452), [`assembly-lines.test.ts:1465`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1468), [`assembly-lines.test.ts:1527`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1526))
- Validation completes before anything is written; the properties it reads — a terminal line's status, definition name, repo and stamped hash — are immutable once observed, so the read-then-write split introduces no window in which a validated fork becomes invalid. ([validated by `assembly-lines.test.ts:1334`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1337), [`assembly-lines.test.ts:1434`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1437), [`assembly-lines.test.ts:1551`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1542), [`assembly-lines.test.ts:1560`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1551))
- The plain (non-fork) start path is unchanged: same statement, same parameters, no copied-rows CTE, and the double agrees with the adapter on it exactly — both state an explicit null parentage in the `assembly_run.start` event, and neither stores a caller-supplied `definitionHash`, which is a resume input the Floor re-stamps. ([validated by `assembly-lines.test.ts:1560`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1551), [`assembly-lines.test.ts:1630`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1621), [`assembly-lines.test.ts:1644`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1635))

## FR3 — Only terminal lines fork

- A `resumeFrom` whose source line is still `queued` or `running` is refused, naming the status. ([validated by `resume.test.ts:240`](libs/shared/src/project/assembly-runs/resume.test.ts#L240), [`assembly-lines.test.ts:1354`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1357), [`assembly-lines.test.ts:1551`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1542))
- A `resumeFrom` whose source line does not exist is refused. ([validated by `resume.test.ts:210`](libs/shared/src/project/assembly-runs/resume.test.ts#L210))
- Decision: the terminal-source rule is the overlap guard's lesson, not squeamishness — the fork reuses the source's branch, so a live source would put two lines on one working branch and let them race for the same commits.

## FR4 — Definition-drift guard

- Decision: `pipeline.assembly_runs` carries the `blueprint_hash`, `resumed_from_run_id` and `resumed_from_node_id` columns (added by the idempotent migration `0036_assembly_line_fork_columns.sql` under their pre-rename names, renamed by 0040) with a partial index on the parentage pointer — schema evidence, not a unit-test target. No FK on `resumed_from_run_id`: losing a source row must never cascade into the fork that outlived it.
- The hash covers the definition's behaviour, not its prose: two loads of the same definition hash equal regardless of key ordering, a reworded `description` is ignored at every depth, and any change to a node or an edge changes it. Node and edge ORDER participates deliberately — `selectEdge` falls back to the first matching candidate, so reordering two `always` edges out of one node can change the walk. The prose exclusion is a denylist, not an allowlist of semantic fields, so a field added to the loader schema later is hashed by default and the guard over-refuses rather than forking across a change it never learned about. ([validated by `definition-hash.test.ts:22`](libs/assembly-lines/src/definition-hash.test.ts#L22), [`definition-hash.test.ts:26`](libs/assembly-lines/src/definition-hash.test.ts#L26), [`definition-hash.test.ts:30`](libs/assembly-lines/src/definition-hash.test.ts#L30), [`definition-hash.test.ts:47`](libs/assembly-lines/src/definition-hash.test.ts#L47), [`definition-hash.test.ts:64`](libs/assembly-lines/src/definition-hash.test.ts#L64), [`definition-hash.test.ts:75`](libs/assembly-lines/src/definition-hash.test.ts#L75), [`definition-hash.test.ts:86`](libs/assembly-lines/src/definition-hash.test.ts#L86), [`definition-hash.test.ts:95`](libs/assembly-lines/src/definition-hash.test.ts#L95), [`definition-hash.test.ts:112`](libs/assembly-lines/src/definition-hash.test.ts#L112), [`definition-hash.test.ts:129`](libs/assembly-lines/src/definition-hash.test.ts#L129))
- The stamp records the hash only when the row carries none, in the Postgres adapter and the in-memory double alike, so a redelivered start that loads a since-edited definition cannot re-point a run at a graph it never ran. *(Amended 2026-08-14: the same call now stores the cloned graph beside the hash — see FR6.38 in `specs/6-dark-factory/spec.md`. The write-once rule is unchanged and covers both, for exactly this reason; the guard's left-hand side becomes the run's OWN stored graph rather than a hash of a file that may no longer exist.)* ([validated by `assembly-lines.test.ts:1115`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1103), [`assembly-lines.test.ts:1126`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1113), [`assembly-lines.test.ts:1135`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1122), [`assembly-lines.test.ts:1145`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1132))
- The Floor's `assembly_run.start` handler stamps the hash once, at the moment the definition resolves, and never overwrites an already-stamped value. ([validated by `start-event-handler.test.ts:240`](apps/floor/src/jobs/assembly-run/start-event-handler.test.ts#L240), [`start-event-handler.test.ts:271`](apps/floor/src/jobs/assembly-run/start-event-handler.test.ts#L271), [`start-event-handler.test.ts:293`](apps/floor/src/jobs/assembly-run/start-event-handler.test.ts#L293))
- A `resumeFrom` start requires the caller to supply the current definition's hash, and rejects a mismatch against the source line's stored hash rather than replaying node rows against a graph that has since changed. ([validated by `resume.test.ts:200`](libs/shared/src/project/assembly-runs/resume.test.ts#L200), [`resume.test.ts:263`](libs/shared/src/project/assembly-runs/resume.test.ts#L263), [`assembly-lines.test.ts:1560`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1551))
- A source line whose stored hash is NULL — every row predating the column — is rejected with a message naming the backfill, an honest limitation preferable to forking across silent definition drift. ([validated by `resume.test.ts:253`](libs/shared/src/project/assembly-runs/resume.test.ts#L253))

## FR5 — Audit trail and walk integration

- The `assembly_run.start` event params carry the fork parentage, so the audit record of *why* a line exists rides with the trigger. ([validated by `assembly-lines.test.ts:1298`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1301), [`assembly-lines.test.ts:1322`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1325), [`assembly-lines.test.ts:1449`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1452))
- The line row itself records `resumed_from_run_id` and `resumed_from_node_id`, because `pipeline.events` rows are pruned once handled and an event alone is not a durable audit substrate. ([validated by `assembly-lines.test.ts:1195`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1180), [`assembly-lines.test.ts:1322`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1325), [`assembly-lines.test.ts:1482`](libs/shared/src/project/assembly-runs/assembly-runs.test.ts#L1484))
- The walk needs no change: the Floor's ordinary start handler marks the forked row running and `advanceLine` replays the inherited rows through `nextTransition`, which returns a launch for the successor of the cutoff node. ([validated by `walk-state.test.ts:6`](apps/floor/src/jobs/assembly-run/walk-state.test.ts#L6), [`advance-line.test.ts:804`](apps/floor/src/jobs/assembly-run/advance-line.test.ts#L804))
- *(added 2026-09-02)* A fork's start REOPENS the settled task it inherits. The source's terminal walk settled the task (`settleTaskForLine`, usually `failed`), and nothing wrote the resumption back: task-keyed surfaces (the implementation-loop page's "current" ticket) kept reporting the source's verdict while the fork ran, and a failed loop task stops guarding its issue — the backlog driver could pick the same ticket into a second task while the fork works the first. The start handler calls settle-task's start-side twin when the event carries a non-null `resumedFrom`: a `failed`/`cancelled`/`completed`/`needs-human-help` task flips back to `running` under CAS — a human retrying from the run page IS the help a parked task waited for — with the transition recorded and the source attempt's `failure_reason` cleared, so a running task never wears a stale failure; open states no-op (a duplicate delivery), and `merged` stays merged — that work shipped, and a fork over it is a deliberate rerun, not the task coming back. ([validated by reopens a failed, cancelled, completed or needs-human-help task as running](apps/floor/src/jobs/assembly-run/reopen-task.test.ts#L44), [`reopen-task.test.ts:51`](apps/floor/src/jobs/assembly-run/reopen-task.test.ts#L51), [`reopen-task.test.ts:67`](apps/floor/src/jobs/assembly-run/reopen-task.test.ts#L67), [`reopen-task.test.ts:78`](apps/floor/src/jobs/assembly-run/reopen-task.test.ts#L78), [`reopen-task.test.ts:93`](apps/floor/src/jobs/assembly-run/reopen-task.test.ts#L93), [a fork's start reopens the settled task before the walk launches](apps/floor/src/jobs/assembly-run/start-event-handler.test.ts#L90), [`start-event-handler.test.ts:108`](apps/floor/src/jobs/assembly-run/start-event-handler.test.ts#L108))
- *(retired 2026-08-19 — the branch-overlap guard was replaced by the subject key, specs/6-dark-factory FR6.49)* A fork used to defer as `lease_held` when it landed on a branch another open line already held, which required the guard to measure against the inherited prefix rather than an empty node list. A fork now INHERITS its source's `subject_key`, so it holds exactly the guard its source held and a second run for that subject cannot be started at all. Safe because forking is legal only from a terminal run, so the key is always free. ([validated by a fork takes over the subject of the run it forks from](libs/shared/src/project/assembly-runs/assembly-runs.contract.test.ts#L770))
- *(retired 2026-08-19 — same replacement)* The guard read the prefix count fixed at fork time rather than one recomputed from current rows, because a fork whose walk revisits the node it resumed from (`implementation.yaml` loops `validate` back to `implement`) would otherwise re-arm the guard mid-walk and close a RUNNING fork as `lease_held`. The failure mode is now structurally impossible rather than guarded against: the subject guard is enforced by a unique index when a run is STARTED, so nothing re-evaluates it while a walk is in progress. ([validated by a fork takes over the subject of the run it forks from](libs/shared/src/project/assembly-runs/assembly-runs.contract.test.ts#L770))

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

## FR6 — The run-page retry affordance *(added 2026-09-02)*

The fork stopped being programmatic-only: the run page's node inspector offers
"Retry from this node" on a terminal run, and the click travels
web-ui → lore-api `POST /api/assembly-runs` → the FR1 `resumeFrom` start. ([validated by offers retry on a finished run's validate node](apps/web-ui/src/app/assembly-runs/[id]/RunVisualizationPanel.test.tsx#L962), [`start-run.test.ts:163`](apps/lore-api/src/api/routes/assembly-lines/start-run.test.ts#L163)) The
retried node is never named on the wire — the button names the fork SOURCE (the
kept prefix's last visit) and the walk replays the retried node as its
successor, so the HTTP surface adds no second routing rule. ([validated by `retry-resume.test.ts:11`](apps/web-ui/src/app/assembly-runs/[id]/retry-resume.test.ts#L11), [`RunVisualizationPanel.test.tsx:962`](apps/web-ui/src/app/assembly-runs/[id]/RunVisualizationPanel.test.tsx#L962))

- `POST /api/assembly-runs` accepts an optional `resume_from: { run_id, node_id, iteration? }` and forwards it to `start` as the FR1 `resumeFrom` input, on the same wire-naming grounds as `definition`; a zero or negative iteration is a schema 400, because visits count from 1. ([validated by `start-run.test.ts:127`](apps/lore-api/src/api/routes/assembly-lines/start-run.test.ts#L163), [passes resume_from.iteration through](apps/lore-api/src/api/routes/assembly-lines/start-run.test.ts#L267), [`start-run.test.ts:288`](apps/lore-api/src/api/routes/assembly-lines/start-run.test.ts#L288), [`start-run.test.ts:304`](apps/lore-api/src/api/routes/assembly-lines/start-run.test.ts#L304))
- `branch` alongside `resume_from` is rejected at the route edge — the FR1 port refuses it too, but a schema 400 names the field instead of surfacing a thrown error as a 500. ([validated by `start-run.test.ts:320`](apps/lore-api/src/api/routes/assembly-lines/start-run.test.ts#L320))
- *(amended 2026-09-02)* The route fills `blueprintHash` from the CURRENT definition on a `resume_from` start — the drift guard's left-hand side loads where the definitions live, since `libs/shared` cannot derive it. Without this, every HTTP fork died as an opaque 500 ("resume-from start requires definitionHash") while the route's own tests, which stub `start`, stayed green. A `resume_from` naming a definition the loader does not know is a 400. ([validated by fills blueprintHash from the current definition](apps/lore-api/src/api/routes/assembly-lines/start-run.test.ts#L189), [`start-run.test.ts:205`](apps/lore-api/src/api/routes/assembly-lines/start-run.test.ts#L205))
- *(amended 2026-09-02)* A fork the port REFUSES — definition drift, a non-terminal source, a visit the source never completed — comes back as a 409 carrying the refusal's own message, because the port validates before writing anything and the person clicking retry needs the reason, not "Internal Server Error". The refusals are their own type (`ResumeRefusedError`), so the mapping discriminates by TYPE, never by message prose: anything else the start throws — a dropped DB connection — surfaces as the 500 it is, because an outage dressed as "the fork was refused" sends the operator chasing definition drift. The web-ui proxy hands the refusal to the button verbatim (4xx pass through; only a reasonless upstream answer degrades to a 502), and the button renders it inline. ([validated by returns 409 carrying the port's refusal](apps/lore-api/src/api/routes/assembly-lines/start-run.test.ts#L229), [lets an unexpected start failure surface as the 500 it is](apps/lore-api/src/api/routes/assembly-lines/start-run.test.ts#L252), [throws ResumeRefusedError for every refusal](libs/shared/src/project/assembly-runs/resume.test.ts#L164))
- The retry target maps to its fork source purely from the visit rows: the visit immediately before the target's latest row, named by `(node_id, iteration)`. *(amended 2026-09-02)* Naming the ITERATION is what keeps the mapping exact on looping lines — the predecessor node may have run again after the retry target (a `validate → implement` back-edge), and on a self-edge the predecessor row belongs to the retried node itself, whose earlier iteration is the cut. The original node-only form refused both shapes; loops are exactly where retries matter most, so the refusal was the defect. ([validated by `retry-resume.test.ts:11`](apps/web-ui/src/app/assembly-runs/[id]/retry-resume.test.ts#L11), [names the predecessor row by iteration when that node ran again later](apps/web-ui/src/app/assembly-runs/[id]/retry-resume.test.ts#L42), [retrying a self-looped node names its own earlier iteration](apps/web-ui/src/app/assembly-runs/[id]/retry-resume.test.ts#L56), [`retry-resume.test.ts:68`](apps/web-ui/src/app/assembly-runs/[id]/retry-resume.test.ts#L68), [offers retry on a looping run's validate node](apps/web-ui/src/app/assembly-runs/[id]/RunVisualizationPanel.test.tsx#L1000))
- No retry is offered where no exact fork exists: the entry node (no prefix to keep), an unvisited node, or a prefix holding a still-open visit. ([validated by `retry-resume.test.ts:27`](apps/web-ui/src/app/assembly-runs/[id]/retry-resume.test.ts#L27), [`retry-resume.test.ts:36`](apps/web-ui/src/app/assembly-runs/[id]/retry-resume.test.ts#L36), [`retry-resume.test.ts:82`](apps/web-ui/src/app/assembly-runs/[id]/retry-resume.test.ts#L82))
- The inspector offers the retry in the node CARD'S HEADER row — beside the outcome pill, where the failure it answers is announced — only on a terminal run with a resolvable fork source, and posts the run id plus the SOURCE visit's node id and iteration as the request body. ([validated by `RunVisualizationPanel.test.tsx:962`](apps/web-ui/src/app/assembly-runs/[id]/RunVisualizationPanel.test.tsx#L962), [`RunVisualizationPanel.test.tsx:1000`](apps/web-ui/src/app/assembly-runs/[id]/RunVisualizationPanel.test.tsx#L1000), [`RunVisualizationPanel.test.tsx:1033`](apps/web-ui/src/app/assembly-runs/[id]/RunVisualizationPanel.test.tsx#L1033), [`RunVisualizationPanel.test.tsx:1050`](apps/web-ui/src/app/assembly-runs/[id]/RunVisualizationPanel.test.tsx#L1050))
- Decision: an `iteration_max` already exhausted at the failure point does not block the retry. The failed visit itself is never copied, so the fork's replay derives exactly one fresh attempt of the retried node; a repeat failure re-derives the same exhaustion and the fork fails the way its source did — honest, and exactly what a bisecting operator wants to observe.
- *(amended 2026-09-02)* The click is a fetch from the page, never a document navigation: the proxy answers JSON (`{ id }` on success), the button navigates to the new run itself, and a failure — the proxy's error or the network's — renders inline beside the button with the control re-enabled, instead of stranding the person on a bare JSON error screen at the API's URL, which is what the original native form POST did with every non-2xx answer. ([validated by posts run_id, node_id and iteration to the rerun proxy over fetch](apps/web-ui/src/app/assembly-runs/[id]/RerunNodeButton.test.tsx#L29), [shows the proxy's error inline and re-enables the button](apps/web-ui/src/app/assembly-runs/[id]/RerunNodeButton.test.tsx#L49), [`RerunNodeButton.test.tsx:67`](apps/web-ui/src/app/assembly-runs/[id]/RerunNodeButton.test.tsx#L67), [`RunVisualizationPanel.test.tsx:962`](apps/web-ui/src/app/assembly-runs/[id]/RunVisualizationPanel.test.tsx#L962))

### Rationale — the proxy's trust boundary

The web-ui proxy (`/api/assembly-runs/rerun`) reads the source run from
lore-api to learn its repo and blueprint — the browser is trusted with ids,
never with authz facts — authorizes the user against that repo, starts the
fork, and redirects to the new run's page. It is coverage-exempt IO glue
(`src/app/api/**`), same as the review-trigger proxy it mirrors.

## FR7 — The retried node hears its own failure history *(added 2026-09-02)*

### Rationale — why the fork needs it

A retry that is handed a byte-identical prompt repeats itself — the
implementation loop already learned this once and grew the incoming-failure
block (`specs/implementation-loop`). The fork re-opens the same hole one level
up: the copy NULLS `failure_class`/`failure_detail` on inherited rows (FR2 —
a copied verdict would kill the replay), and the failed visit is not copied at
all, so a forked run's own rows cannot say why its retried node failed. The
details live only on the source run's rows, one `resumed_from_run_id` hop away.

### Requirements

- An agent node's dispatch prompt carries the node's OWN earlier failed attempts — every recorded failed visit of that node with a failure detail, oldest first; detail-less visits and non-failure outcomes (`success`, `changes_requested`) contribute nothing. ([validated by collects every failed attempt of the launched node](apps/floor/src/jobs/assembly-run/launch-spec.test.ts#L92), [`launch-spec.test.ts:107`](apps/floor/src/jobs/assembly-run/launch-spec.test.ts#L107))
- The attempts render as their own prompt section, capped at the last 3 with each detail truncated at the same bound as the incoming-failure block; no failures, no section. It is appended IN ADDITION to the incoming-failure block — they answer different questions ("what just routed here" vs "what did I break on before") — and an attempt identical to the incoming failure is dropped rather than shown twice. ([validated by returns the prompt untouched with no prior failures](apps/floor/src/jobs/assembly-run/launch-spec.test.ts#L118), [`launch-spec.test.ts:122`](apps/floor/src/jobs/assembly-run/launch-spec.test.ts#L122), [`launch-spec.test.ts:136`](apps/floor/src/jobs/assembly-run/launch-spec.test.ts#L136))
- On a forked run, the history is read through the `resumed_from_run_id` chain — each source run's rows keep their details, and a fork of a fork contributes each ancestor's attempts, oldest ancestor first, bounded at 5 hops. The fork's FIRST launch is precisely the retried node, so the source's failure reaches exactly the dispatch the retry exists for. ([validated by a forked run's first launch carries the source run's failure detail](apps/floor/src/jobs/assembly-run/finish-node.test.ts#L278), [follows a fork-of-fork chain oldest first and stops at the hop bound](apps/floor/src/jobs/assembly-run/finish-node.test.ts#L343))
- A run that is no fork reads nothing beyond the visit rows the walk already holds — the source-run reads are gated on `resumed_from_run_id`, so the plain path pays zero extra queries. ([validated by a plain run reads no source runs while dispatching](apps/floor/src/jobs/assembly-run/finish-node.test.ts#L400))

## Out of Scope
- Editing inherited node state (outcomes, commit shas) on fork.
- Backfilling `blueprint_hash` for historical rows.
- Forking a line whose definition is not a builtin assembly line (a
  single-CR run record has no graph to replay).
