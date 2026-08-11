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
- `branch` is inherited from the source line, and passing `branch` alongside `resumeFrom` is a validation error rather than a silent override. ([validated by `resume.test.ts:136`](libs/shared/src/project/assembly-lines/resume.test.ts#L136), [`assembly-lines.test.ts:1166`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1166))
- `taskId` is inherited from the source line, and passing `taskId` alongside `resumeFrom` is a validation error on the same grounds. ([validated by `resume.test.ts:146`](libs/shared/src/project/assembly-lines/resume.test.ts#L146), [`assembly-lines.test.ts:1166`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1166))
- `args` are inherited from the source line when omitted and replaced wholesale when supplied, so an operator can inject corrected inputs for the replayed remainder; a legacy source row whose `args` column is NULL forks with `{}`, exactly as a plain start would store. ([validated by `assembly-lines.test.ts:965`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L965), [`assembly-lines.test.ts:1189`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1189), [`assembly-lines.test.ts:1241`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1241))
- A `resumeFrom` start whose `repo` differs from the source line's is rejected: a fork inherits the source's branch, and a branch means nothing in another repository. ([validated by `resume.test.ts:176`](libs/shared/src/project/assembly-lines/resume.test.ts#L176))
- A `resumeFrom` start whose `definitionName` differs from the source line's is rejected — replaying one definition's node rows against another definition's graph is not a fork. ([validated by `resume.test.ts:186`](libs/shared/src/project/assembly-lines/resume.test.ts#L186))
- The repo-scoped `AssemblyLines` facade passes `resumeFrom` through unchanged, so callers write `project.assemblyLines.start(name, { resumeFrom, definitionHash })`. ([validated by `assembly-lines.test.ts:1270`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1270))

## FR2 — Copy semantics

- The copy runs through the chosen node's **latest completed row inclusive**, so earlier iterations of that node — everything a back-edge produced before it — ride along in visit order. ([validated by `resume.test.ts:75`](libs/shared/src/project/assembly-lines/resume.test.ts#L75), [`resume.test.ts:80`](libs/shared/src/project/assembly-lines/resume.test.ts#L80), [`resume.test.ts:84`](libs/shared/src/project/assembly-lines/resume.test.ts#L84), [`resume.test.ts:90`](libs/shared/src/project/assembly-lines/resume.test.ts#L90), [`resume.test.ts:101`](libs/shared/src/project/assembly-lines/resume.test.ts#L101), [`resume.test.ts:128`](libs/shared/src/project/assembly-lines/resume.test.ts#L128), [`assembly-lines.test.ts:902`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L902), [`assembly-lines.test.ts:1149`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1149))
- Copied rows carry the source row's `outcome`, `commit_sha`, `started_at` and `finished_at` — the inherited prefix keeps the provenance of the run that actually produced it rather than masquerading as fresh work — but never its `agent_cr_name`, which is nulled on copy: the run-viz and cost correlation joins resolve a CR name to the newest matching node row, and an echoed name would steal the source's late-arriving agent-event and cost rows. ([validated by `resume.test.ts:111`](libs/shared/src/project/assembly-lines/resume.test.ts#L111), [`assembly-lines.test.ts:902`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L902), [`assembly-lines.test.ts:1205`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1205))
- A `resumeFrom` naming a node the source line never completed — never visited, or visited and still open — is rejected, because there is no replayable prefix to copy. ([validated by `resume.test.ts:231`](libs/shared/src/project/assembly-lines/resume.test.ts#L231))
- A prefix containing an unfinished row before the cutoff is rejected: an outcome-less row replays as `await`, so copying it would mint a line that can never advance. ([validated by `resume.test.ts:245`](libs/shared/src/project/assembly-lines/resume.test.ts#L245))
- The Postgres adapter writes the line row, the `assembly_line.start` event and every copied node row in ONE data-modifying CTE, exactly as a plain start writes its two, so a fork is never half-created. ([validated by `assembly-lines.test.ts:1133`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1133), [`assembly-lines.test.ts:1149`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1149), [`assembly-lines.test.ts:1205`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1205))
- Validation completes before anything is written; the properties it reads — a terminal line's status, definition name, repo and stamped hash — are immutable once observed, so the read-then-write split introduces no window in which a validated fork becomes invalid. ([validated by `assembly-lines.test.ts:1018`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1018), [`assembly-lines.test.ts:1118`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1118), [`assembly-lines.test.ts:1220`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1220), [`assembly-lines.test.ts:1229`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1229))
- The plain (non-fork) start path is unchanged: same statement, same parameters, no copied-rows CTE, and the double agrees with the adapter on it exactly — both state an explicit null parentage in the `assembly_line.start` event, and neither stores a caller-supplied `definitionHash`, which is a resume input the Floor re-stamps. ([validated by `assembly-lines.test.ts:1253`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1253), [`assembly-lines.test.ts:1301`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1301), [`assembly-lines.test.ts:1315`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1315))

## FR3 — Only terminal lines fork

- A `resumeFrom` whose source line is still `queued` or `running` is refused, naming the status. ([validated by `resume.test.ts:200`](libs/shared/src/project/assembly-lines/resume.test.ts#L200), [`assembly-lines.test.ts:1038`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1038), [`assembly-lines.test.ts:1220`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1220))
- A `resumeFrom` whose source line does not exist is refused. ([validated by `resume.test.ts:170`](libs/shared/src/project/assembly-lines/resume.test.ts#L170))
- Decision: the terminal-source rule is the overlap guard's lesson, not squeamishness — the fork reuses the source's branch, so a live source would put two lines on one working branch and let them race for the same commits.

## FR4 — Definition-drift guard

- Decision: `pipeline.assembly_lines` carries the `definition_hash`, `resumed_from_line_id` and `resumed_from_node_id` columns, added by the idempotent migration `0036_assembly_line_fork_columns.sql` with a partial index on the parentage pointer — schema evidence, not a unit-test target. No FK on `resumed_from_line_id`: losing a source row must never cascade into the fork that outlived it.
- The hash covers the definition's behaviour, not its prose: two loads of the same definition hash equal regardless of key ordering, a reworded `description` is ignored at every depth, and any change to a node or an edge changes it. Node and edge ORDER participates deliberately — `selectEdge` falls back to the first matching candidate, so reordering two `always` edges out of one node can change the walk. The prose exclusion is a denylist, not an allowlist of semantic fields, so a field added to the loader schema later is hashed by default and the guard over-refuses rather than forking across a change it never learned about. ([validated by `definition-hash.test.ts:22`](libs/assembly-lines/src/definition-hash.test.ts#L22), [`definition-hash.test.ts:26`](libs/assembly-lines/src/definition-hash.test.ts#L26), [`definition-hash.test.ts:30`](libs/assembly-lines/src/definition-hash.test.ts#L30), [`definition-hash.test.ts:47`](libs/assembly-lines/src/definition-hash.test.ts#L47), [`definition-hash.test.ts:64`](libs/assembly-lines/src/definition-hash.test.ts#L64), [`definition-hash.test.ts:75`](libs/assembly-lines/src/definition-hash.test.ts#L75), [`definition-hash.test.ts:86`](libs/assembly-lines/src/definition-hash.test.ts#L86), [`definition-hash.test.ts:95`](libs/assembly-lines/src/definition-hash.test.ts#L95), [`definition-hash.test.ts:112`](libs/assembly-lines/src/definition-hash.test.ts#L112), [`definition-hash.test.ts:129`](libs/assembly-lines/src/definition-hash.test.ts#L129))
- `stampDefinitionHash` records the hash only when the row carries none, in the Postgres adapter and the in-memory double alike, so a redelivered start that loads a since-edited definition cannot re-point a line at a graph it never ran. ([validated by `assembly-lines.test.ts:800`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L800), [`assembly-lines.test.ts:810`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L810), [`assembly-lines.test.ts:819`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L819), [`assembly-lines.test.ts:829`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L829))
- The Floor's `assembly_line.start` handler stamps the hash once, at the moment the definition resolves, and never overwrites an already-stamped value. ([validated by `start-event-handler.test.ts:215`](apps/floor/src/jobs/assembly-line/start-event-handler.test.ts#L215), [`start-event-handler.test.ts:230`](apps/floor/src/jobs/assembly-line/start-event-handler.test.ts#L230), [`start-event-handler.test.ts:252`](apps/floor/src/jobs/assembly-line/start-event-handler.test.ts#L252))
- A `resumeFrom` start requires the caller to supply the current definition's hash, and rejects a mismatch against the source line's stored hash rather than replaying node rows against a graph that has since changed. ([validated by `resume.test.ts:156`](libs/shared/src/project/assembly-lines/resume.test.ts#L156), [`resume.test.ts:223`](libs/shared/src/project/assembly-lines/resume.test.ts#L223), [`assembly-lines.test.ts:1229`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1229))
- A source line whose stored hash is NULL — every row predating the column — is rejected with a message naming the backfill, an honest limitation preferable to forking across silent definition drift. ([validated by `resume.test.ts:213`](libs/shared/src/project/assembly-lines/resume.test.ts#L213))

## FR5 — Audit trail and walk integration

- The `assembly_line.start` event params carry the fork parentage, so the audit record of *why* a line exists rides with the trigger. ([validated by `assembly-lines.test.ts:982`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L982), [`assembly-lines.test.ts:1006`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1006), [`assembly-lines.test.ts:1133`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1133))
- The line row itself records `resumed_from_line_id` and `resumed_from_node_id`, because `pipeline.events` rows are pruned once handled and an event alone is not a durable audit substrate. ([validated by `assembly-lines.test.ts:879`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L879), [`assembly-lines.test.ts:1006`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1006), [`assembly-lines.test.ts:1166`](libs/shared/src/project/assembly-lines/assembly-lines.test.ts#L1166))
- The walk needs no change: the Floor's ordinary start handler marks the forked row running and `advanceLine` replays the inherited rows through `nextTransition`, which returns a launch for the successor of the cutoff node. ([validated by `advance.test.ts:704`](apps/floor/src/jobs/assembly-line/advance.test.ts#L704), [`advance.test.ts:723`](apps/floor/src/jobs/assembly-line/advance.test.ts#L723))
- The branch-overlap guard measures against the inherited prefix rather than an empty node list, so a fork that lands on a branch another open line already holds still defers as `lease_held` instead of racing it. ([validated by `advance.test.ts:736`](apps/floor/src/jobs/assembly-line/advance.test.ts#L736), [`advance.test.ts:759`](apps/floor/src/jobs/assembly-line/advance.test.ts#L759), [`advance.test.ts:771`](apps/floor/src/jobs/assembly-line/advance.test.ts#L771))
- The prefix size the guard reads is the count fixed at fork time, never one recomputed from the line's current rows. A fork's own walk may revisit the node it resumed from — `implementation.yaml` loops `validate` back to `implement` — which would make a recomputed count grow back to the row count and re-arm the guard mid-walk, closing a RUNNING fork as `lease_held`. The stored count cannot move, so the test is false forever after the fork's first launch. ([validated by `advance.test.ts:869`](apps/floor/src/jobs/assembly-line/advance.test.ts#L869), [`advance.test.ts:771`](apps/floor/src/jobs/assembly-line/advance.test.ts#L771))

## FR6 — Trigger surface

- Decision: this section is the follow-up issue #1144's scope — without a
  caller, the fork API is dead code. The run-detail page is the trigger; the
  Floor is the only service that both loads definitions (the drift guard's
  current-hash side) and holds the project facade, so the route lives there
  and the UI proxies to it.
- The Floor exposes `POST /api/assembly-lines/{id}/rerun` behind the ingest-token bearer strategy, taking the node to resume from as `node_id`. ([validated by `assembly-line-rerun.test.ts:76`](apps/floor/src/delivery/http/routes/assembly-line-rerun.test.ts#L76), [`assembly-line-rerun.test.ts:89`](apps/floor/src/delivery/http/routes/assembly-line-rerun.test.ts#L89))
- The route resolves the source line by id (404 when it does not exist) and refuses a line whose definition is not a builtin assembly line — a single-CR run record has no graph to replay. ([validated by `assembly-line-rerun.test.ts:96`](apps/floor/src/delivery/http/routes/assembly-line-rerun.test.ts#L96), [`assembly-line-rerun.test.ts:108`](apps/floor/src/delivery/http/routes/assembly-line-rerun.test.ts#L108))
- The route is the caller FR4 was designed around: it loads the CURRENT builtin definition, hashes it, and passes the hash to `resumeFrom`, returning 202 with the fork's line id. ([validated by `assembly-line-rerun.test.ts:125`](apps/floor/src/delivery/http/routes/assembly-line-rerun.test.ts#L125))
- A port refusal (non-terminal source, unknown node, hash drift, NULL stored hash) is a state conflict, not a malformed request — it surfaces as 409 carrying the port's message. ([validated by `assembly-line-rerun.test.ts:143`](apps/floor/src/delivery/http/routes/assembly-line-rerun.test.ts#L143))
- The web-ui proxies the button through `POST /api/assembly-lines/[id]/rerun` with the same auth ladder as the run's other proxies — session (401) → run lookup (404) → repo access (403) — so the human is authorized against the run's repo while the ingest token stays server-side. ([validated by `route.test.ts:54`](apps/web-ui/src/app/api/assembly-lines/[id]/rerun/route.test.ts#L54), [`route.test.ts:59`](apps/web-ui/src/app/api/assembly-lines/[id]/rerun/route.test.ts#L59), [`route.test.ts:68`](apps/web-ui/src/app/api/assembly-lines/[id]/rerun/route.test.ts#L68), [`route.test.ts:78`](apps/web-ui/src/app/api/assembly-lines/[id]/rerun/route.test.ts#L78))
- The proxy requires `node_id`, forwards it to the Floor with the server-held bearer, and redirects to the new fork's run page so the operator lands on the attempt they just started. ([validated by `route.test.ts:94`](apps/web-ui/src/app/api/assembly-lines/[id]/rerun/route.test.ts#L94), [`route.test.ts:110`](apps/web-ui/src/app/api/assembly-lines/[id]/rerun/route.test.ts#L110), [`route.test.ts:125`](apps/web-ui/src/app/api/assembly-lines/[id]/rerun/route.test.ts#L125))
- A Floor refusal is surfaced with its reason rather than a bare status, because "definition hash mismatch" is actionable and "502" is not. ([validated by `route.test.ts:134`](apps/web-ui/src/app/api/assembly-lines/[id]/rerun/route.test.ts#L134))
- The run page offers "Rerun from here" only where the port could say yes: on a terminal run whose definition is a real builtin (a synthetic graph has nothing to hash), on completed node rows, and once per node on its latest row — forking always resumes from a node's latest completed iteration, so earlier rows would duplicate the offer. ([validated by `AssemblyLineRunView.test.tsx:214`](apps/web-ui/src/app/assembly-lines/[id]/AssemblyLineRunView.test.tsx#L214), [`AssemblyLineRunView.test.tsx:238`](apps/web-ui/src/app/assembly-lines/[id]/AssemblyLineRunView.test.tsx#L238), [`AssemblyLineRunView.test.tsx:253`](apps/web-ui/src/app/assembly-lines/[id]/AssemblyLineRunView.test.tsx#L253), [`AssemblyLineRunView.test.tsx:267`](apps/web-ui/src/app/assembly-lines/[id]/AssemblyLineRunView.test.tsx#L267))

## FR7 — Inherited rows on the fork's run page

- The run fetcher carries the fork parentage and the inherited prefix size, mapping a plain start to null parentage and a zero prefix. ([validated by `assembly-line-runs.test.ts:82`](apps/web-ui/src/lib/assembly-line-runs.test.ts#L82), [`assembly-line-runs.test.ts:97`](apps/web-ui/src/lib/assembly-line-runs.test.ts#L97))
- A forked run's header links the source line via `resumed_from_line_id` and names the resumed-from node — the source, one hop away, keeps the full logs/events history the inherited rows deliberately do not carry. ([validated by `AssemblyLineRunView.test.tsx:165`](apps/web-ui/src/app/assembly-lines/[id]/AssemblyLineRunView.test.tsx#L165))
- The first `inherited_node_count` steps in id order are marked as inherited; a plain run shows no such marker. Pod-log links need no special case: inherited rows carry no `agent_cr_name`, so the existing CR-name filter already excludes them. ([validated by `AssemblyLineRunView.test.tsx:183`](apps/web-ui/src/app/assembly-lines/[id]/AssemblyLineRunView.test.tsx#L183), [`AssemblyLineRunView.test.tsx:202`](apps/web-ui/src/app/assembly-lines/[id]/AssemblyLineRunView.test.tsx#L202))

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
  fork's run page; the source line, one `resumed_from_line_id` hop away,
  keeps the full history. Safe for the walk and the reaper: every
  inherited row is proven terminal by `resolveResumePrefix`, and only
  open rows are ever read back by CR name.
- A copied row is identifiable to consumers without a per-row flag: a
  fork's inherited rows are exactly its first `inherited_node_count` node
  rows in id order.
- Rows predating the `definition_hash` column cannot be forked until
  backfilled. No backfill ships here; the rejection message names the
  column so the operator knows what to fill.

## Out of Scope

- An MCP tool for operators (`lore_rerun_assembly_line`). The run-detail
  button (FR6) is the trigger surface issue #1144 asked for; the "and/or"
  MCP twin can follow if operators want one away from the UI.
- Replacing `args` from the UI. The port supports it (FR1); the button forks
  with inherited args because a free-text args editor on the run page is a
  bigger affordance than the rerun itself.
- Editing inherited node state (outcomes, commit shas) on fork.
- Backfilling `definition_hash` for historical rows.
- Forking a line whose definition is not a builtin assembly line (a
  single-CR run record has no graph to replay).
