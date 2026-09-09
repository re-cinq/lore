# Definition of Done

> The Floor still reads Agent CRs from the central cluster on paths a satellite
> run can take.
>
> **Proposal:** make the Floor consume reported state and stop reading CRs. Where
> a read is genuinely needed (pod logs, a live probe), route it to the
> cluster-agent that *claimed* the run, resolved from the station-run row, rather
> than to the central one by default.
>
> **Acceptance**
> - A written decision (ADR amendment) on which reads survive and how they are routed.
> - No default-to-central CR read on a path a satellite run can take.

**Strategy: `changes_requested`** — this ticket cannot be turned into a small
set of failing acceptance tests that fail for its own stated reason, for two
structural reasons.

1. **The first acceptance criterion is unobservable.** "A written decision (ADR
   amendment) on which reads survive and how they are routed" is a design
   artifact, not a behaviour reachable through a real entry point. The only test
   that could assert it exists would `readFileSync` an ADR and regex for a
   heading — a source-text scan, which the DoD contract forbids.

2. **The second criterion depends on a design that criterion 1 has not yet
   made.** "Route it to the cluster-agent that claimed the run, resolved from the
   station-run row" is new routing infrastructure that does not exist anywhere in
   the Floor today (confirmed: no per-row cluster-agent resolution in
   `jobs/watcher` or `listeners/agent-reconcile`). To write an acceptance test I
   would have to invent the shape of that routing — which reads survive, how the
   claiming agent is resolved and reached, how a backstop that lists CRs (not
   rows) reaches satellites at all — and that shape IS the ADR amendment the
   ticket says must "land before implementation." Writing the test now redefines
   the ticket instead of pinning it.

The ticket also self-describes as an epic: "This is the largest of the four" and
"should land as an amendment to ADR-044 before implementation." It is really a
design decision followed by several per-path implementation slices.

## What is already done on this branch (green, keep)

The prior cycle correctly identified and fixed ONE self-contained sub-bug and
left a passing acceptance test for it:

- **node-event-handler.test.ts** — "does not read the central cluster's CR when a
  duplicate event arrives for a node a satellite already settled while the line
  is still running" — PASSES today.
  `apps/floor/src/jobs/assembly-run/node-event-handler.test.ts`

That closes the `node-event-handler` phantom-re-settlement path. It does not, on
its own, satisfy either ticket-level acceptance bullet.

## Why the remaining scope is still open (evidence)

- [ ] **ADR-044 amendment** — no ADR file was changed on this branch
  (`git diff --name-only origin/main...HEAD` touches no `adrs/`). Acceptance
  bullet 1 is unmet, and it is a writing task for a human/design step, not a test.
- [ ] **`agent-reconcile` still defaults to central** — `reconcileAgents` is
  `new HttpAgentApi(clusterAgent())` (central-only). A satellite-claimed
  single-CR run whose terminal event was dropped is invisible to this backstop —
  exactly the "backstop reads the wrong cluster, reports 'gone' for a run that is
  fine" failure the ticket names. Fixing it needs the routing design (bullet 1):
  a backstop that lists CRs has no station-run row to resolve a claimant from, so
  "how it is routed" is a genuine open question, not an implementation detail.
- [ ] **No per-row read routing exists** — nothing resolves a read to the
  claiming cluster-agent from `clusterAgentId`. Acceptance bullet 2 is unmet
  beyond the one node-handler path.

## What is needed to unblock (turn this into testable tickets)

1. Land the ADR-044 amendment deciding, per read site
   (`agent-watcher`, `agent-reconcile`, `node-event-handler`, `jobs/kubernetes`,
   the assembly-run reaper): does the read survive at all, and if so is it routed
   to the claiming cluster-agent (resolved how — from the station-run row; and
   how does a CR-listing backstop reach satellites it cannot list?).
2. Split into per-path implementation slices, each of which THEN has a crisp,
   testable "no central read on a satellite path" acceptance test against the
   routing seam the ADR defines.

## Out of scope for a single DoD test round

- Inventing the routing design in test form ahead of the ADR.
- The already-green `node-event-handler` duplicate-event slice (done).
