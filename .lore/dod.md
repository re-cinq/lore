# DoD — issue-1627: Floor still reads Agent CRs from central cluster on satellite paths

## Ticket

The Floor still reads Agent CRs from the central cluster on paths a satellite run can take.

## Root cause

`createNodeEventHandler` guards satellite-claimed station runs with `agentCrVisible`, but
only when an **open** station-run row is found for the arriving `nodeId`. When no open row
exists — because the node was already settled on the first delivery and the walk advanced
to the next node (the line is still `running`) — the guard never fires and the handler
falls through to `readAgentStatus`. That call goes to the **central** cluster, which
returns `null` for a CR that lives in a satellite cluster. The fallback converts the null
into `{ phase: "Succeeded" }` — a phantom re-settlement that contradicts the actual
satellite outcome.

Reproduction: a multi-node line where the first node was claimed and settled by a
satellite; a late duplicate `kubernetes.agent_node.succeeded` event (without
`params.status`, the form an old cluster-agent sends) arrives while the line is still
`running` for its next node.

## Strategy

`direct` — the seam already exists: `createNodeEventHandler` accepts injectable deps,
and `deps.readAgentStatus` is captured by reference so tests can splice in a recorder
after construction.

## Acceptance tests

| File | Line | Description |
|------|------|-------------|
| `apps/floor/src/jobs/assembly-run/node-event-handler.test.ts` | 432 | "does not read the central cluster's CR when a duplicate event arrives for a node a satellite already settled while the line is still running" |

All tests pass ⟺ the handler returns early (without calling `readAgentStatus`) whenever
it finds no open station-run row for the arriving node, regardless of whether the
assembly run is still open for other nodes.

## Facets covered

- `node-event-handler.ts`: the `if (reported === null)` block must return early when
  `openRow` is `null`, rather than falling through to `readAgentStatus`.

## Out of scope

- Wiring `centralClusterAgentId` in `productionNodeEventDeps()`: that omission affects
  central-claimed nodes on old events (no `params.status`), which is a separate and lower-
  priority gap not described by this ticket.
- Two-cycle reaper behavior: the spec's "two reaper cycles" description is a worst-case
  bound; the implementation does mark-offline and requeue in a single cycle, which is
  correct and tested.
- Reconcile backstop for satellite-claimed single-CR tasks: satellites report through
  the event bus; the reconcile only sees central CRs. Out of scope per the spec's
  Out of Scope section.
