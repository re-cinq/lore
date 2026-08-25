# Lore Assembly Lines (`@re-cinq/lore-assembly-lines`)

The **assembly-line definition + transition kernel** — the declarative YAML
graphs Lore's autonomous workflows run as, the loader that validates them, the
pure transition replay the event-driven walk routes on, and the station
contract's outcome parsing. Consumed by the Floor (`apps/floor`, which advances
runs on `kubernetes.agent_node.*` events) and by the `lore-station` pods (which
parse their own result lines). See
[ADR-024](../../adrs/ADR-024-ubiquitous-language-execution-model.md) for the
Factory ⊃ Floor ⊃ **AssemblyLine** ⊃ Station ⊃ Agent vocabulary,
[ADR-031](../../adrs/ADR-031-agent-station-crds.md) for the execution model, and
[specs/6-dark-factory/](../../specs/6-dark-factory/) for the workflow spec.
Depends only on `@re-cinq/lore-shared` — no DB, Octokit, or K8s client.

## Definitions

An assembly line is a small directed graph: **nodes** (typed stations — `agent`,
`validate`, `detect`, `merge_step`, human stations, …) joined by **edges** that
route on the producing node's outcome (`success` / `changes_requested` /
`failed` / `always`). Builtin definitions live in
[`src/assembly-lines/`](./src/assembly-lines/) and are copied into `dist/` at
build time (`loadBuiltinAssemblyLines`):

| Definition | Purpose |
| --- | --- |
| `implementation.yaml` | Implement a spec, validate, push, review; feedback loop up to 2 iterations |
| `general.yaml` | Linear implement → validate → push → review → retrospective for general tasks |
| `gap-fill.yaml` | Draft missing docs (CLAUDE.md / ADR / runbook), validate, push |
| `feature-planning.yaml` | One interactive planning round emitting a structured GapResult (no commit/PR) |
| `ingest.yaml` | Project one `internal.ingest.*` payload into the spec-traceability graph |
| `merge.yaml` | Everything that must happen once a task's PR merges, one recorded step at a time |
| `escalation.yaml` | File the `needs-human-help` Issue when a task needs a person |
| `code-review.yaml` | Review a PR: structured findings + REVIEW_RESULT verdict (suggestion-only) |
| `code-review-reply.yaml` | Act on a human reply — answer in-thread or commit the approved fix |
| `code-review-recheck.yaml` | Cheap re-check after a new push so the formal verdict tracks the fix |
| `comment-triage.yaml` | Haiku station classifying a PR comment into review / address / answer / ignore |
| `gap-detect.yaml` | Per-repo documentation-gap detection; files gap-fill tasks |
| `spec-drift.yaml` | Per-repo spec-drift detection; files gap-fill tasks for drifted specs |
| `spec-coverage-validate.yaml` | Resolve every inline `([validated by])` link; file spec-link-rot issues |
| `spec-coverage-backfill.yaml` | Judge un-linked testable statements; open link-suggestion PRs |

## Loader (`src/loader.ts`)

`parseAssemblyLine` / `loadAssemblyLineDir` validate with **strict Zod objects**
(a mistyped key is a load failure, not a silently dropped field), then check the
graph: entry/exit and edge endpoints must name real nodes, every node must be
reachable (BFS), only the exit node may be terminal, and every **producible
outcome** of a node must have a matching edge. Cycles are found by **DFS
coloring**; a back-edge without `iteration_max` is rejected unless a human
station gates the loop. Nodes carry optional `station_ref` (custom station
image) and `timeout_minutes`; `detect` / `merge_step` / `escalation_step` nodes
require `job_ref` (one type, many handlers); human stations require `route`.

## Transition replay (`src/transition.ts`)

`getNextTransition()` is the sole definition of the walk's routing: a **pure
replay** that derives the next step — `launch` / `await` / `finish` / `fail` —
from nothing but the persisted `pipeline.station_runs` rows and the definition
graph. `selectEdge` prefers the exact-outcome edge over `always`; revisits bump
the iteration and budgeted back-edges fail the run past `iteration_max`; a
permanently classified node failure refuses the retry and reports the real
cause. Because the state is the rows, duplicate or concurrent advancers
converge and a Floor restart loses nothing (spec 6-dark-factory FR6.9). The
event-driven walk in `apps/floor/src/jobs/assembly-run/advance.ts` is its
Floor-side driver; the old in-process `executeAssemblyLine` is retired.

## Outcome parsing (`src/node-outcome.ts`, `src/node-types.ts`)

`stationNodeOutcome()` maps a terminal Agent CR status to the node outcome the
replay routes on, per the
[station contract](../../specs/6-dark-factory/contracts/station-contract.md):
CR phase `Failed` → infrastructure `failed` (with a classified
`failureClass`/`failureDetail`); otherwise the last line-start
**`LORE_NODE_RESULT:`** marker (`parseNodeResult`, JSON payload or the legacy
bare word) wins, then the agent-review **`REVIEW_RESULT:`** line
(`parseReviewVerdict`), then `success`. A marker that is present but
unparseable fails the node instead of defaulting — a drifted recipe reports
itself. `node-types.ts` holds the shared vocabulary (`StageOutcome`,
`NodeResult`, `NodeContext`).

## Limits

Only the Floor executes these definitions today: the mcp-server local runner
spawns Claude Code directly and does not load them, so the shared-interpretation
goal (spec 6-dark-factory FR2.3) is aspirational until it adopts the library.

## Develop

```bash
npm install                                    # from the repo root (workspace member)
npm run build -w @re-cinq/lore-assembly-lines  # tsc + copy the YAMLs into dist/
npm test  -w @re-cinq/lore-assembly-lines
```
