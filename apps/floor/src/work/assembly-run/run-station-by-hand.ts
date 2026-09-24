/** A person runs one station of a line (specs/fork-rerun-from-node FR8): the node's next iteration, in the SAME run, recorded under their name so the walk replay restarts there. */

import { humanStationIds, type NodeVisit } from "@re-cinq/lore-assembly-lines";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { launchResolved, resolveLaunch } from "./advance-line.js";
import type { AdvanceDeps } from "./advance-deps.js";
import { loadWalkState, type WalkState } from "./walk-state.js";

export interface HandRun {
  nodeId: string;
  actor: string;
}

export interface RunStationByHandDeps extends AdvanceDeps {
  /** Puts the run's settled task back to running; best-effort, like the fork's reopen. */
  reopenTask?: (assemblyRunId: string) => Promise<void>;
}

/** Reopens an ended run, closes a wait it is parked on, and launches the node. A machine station still in flight launches nothing: two pods would work one branch at once. */
export async function runStationByHand(
  assemblyRunId: string,
  handRun: HandRun,
  deps: RunStationByHandDeps,
): Promise<void> {
  // lore-api reopened it already so the page goes live; a reaper tick that re-closed it in between is undone here.
  if (await deps.assemblyRuns.reopen(assemblyRunId)) {
    await deps.reopenTask?.(assemblyRunId);
  }
  const state = await loadWalkState(assemblyRunId, deps);

  if (!state || machineInFlight(state)) {
    console.log(
      `[run-station] ${assemblyRunId}: not running ${handRun.nodeId} for ${handRun.actor} — the run is gone or a station is still working`,
    );

    return;
  }
  // Resolved first: a dispatch that cannot be built must leave the wait parked, not cancel it and fail the line (plan b4b2026f, 2026-09-24).
  const launch = await resolveByHand(state, handRun, deps);

  await closeParkedWaits(state, handRun, deps);
  await launchResolved(launch, deps);
  await deps.publishRunCheck?.(assemblyRunId);
}

function machineInFlight({ runGraph, visits }: WalkState): boolean {
  const human = humanStationIds(runGraph);

  return visits.some(
    (visit) => visit.outcome === null && !human.has(visit.nodeId),
  );
}

// The person moved the walk on, so the wait is over rather than failed: `cancelled` routes nothing, since the replay restarts at the hand-run visit.
async function closeParkedWaits(
  state: WalkState,
  { nodeId, actor }: HandRun,
  deps: AdvanceDeps,
): Promise<void> {
  const rows = (
    await deps.assemblyRuns.listStationRuns(state.assemblyRun.id)
  ).filter((row) => row.outcome === null);

  await Promise.all(
    rows.map((row) =>
      deps.assemblyRuns.finishStationRunOnce(row.id, "cancelled", undefined, {
        failureDetail: `${actor} ran the ${nodeId} station by hand`,
      }),
    ),
  );
}

// lore-api checked the node against this graph, so a missing one means the graph changed under the ask — failing the event says so.
function resolveByHand(
  state: WalkState,
  { nodeId, actor }: HandRun,
  deps: AdvanceDeps,
): ReturnType<typeof resolveLaunch> {
  const { runGraph, visits } = state;
  const node = runGraph.nodes.find((n) => n.id === nodeId);

  enforceTrue(node, Error, `${runGraph.name} has no station "${nodeId}"`);

  return resolveLaunch(
    node,
    {
      kind: "launch",
      nodeId,
      iteration: nextIteration(visits, nodeId),
      requestedBy: actor,
    },
    state,
    deps,
  );
}

function nextIteration(visits: readonly NodeVisit[], nodeId: string): number {
  const own = visits.filter((visit) => visit.nodeId === nodeId);

  return Math.max(0, ...own.map((visit) => visit.iteration)) + 1;
}
