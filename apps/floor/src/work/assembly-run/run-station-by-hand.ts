/** A person runs one station of a line (specs/fork-rerun-from-node FR8): the node's next iteration, in the SAME run, recorded under their name so the walk replay restarts there. */

import { isHumanStation } from "@re-cinq/lore-assembly-lines";
import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import { launchTransition } from "./advance-line.js";
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
  await closeParkedWaits(state, handRun, deps);
  await launchByHand(state, handRun, deps);
  await deps.publishRunCheck?.(assemblyRunId);
}

function machineInFlight(state: WalkState): boolean {
  return state.visits.some(
    (visit) =>
      visit.outcome === null && !humanIds(state.runGraph).has(visit.nodeId),
  );
}

function humanIds(graph: RunGraph): Set<string> {
  return new Set(
    graph.nodes.filter((node) => isHumanStation(node.type)).map((node) => node.id),
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

async function launchByHand(
  state: WalkState,
  { nodeId, actor }: HandRun,
  deps: AdvanceDeps,
): Promise<void> {
  const node = state.runGraph.nodes.find((n) => n.id === nodeId);

  if (!node) {
    console.log(`[run-station] ${state.assemblyRun.id}: no station "${nodeId}"`);

    return;
  }
  const iteration =
    Math.max(
      0,
      ...state.visits.filter((v) => v.nodeId === nodeId).map((v) => v.iteration),
    ) + 1;

  await launchTransition(
    node,
    { kind: "launch", nodeId, iteration },
    state,
    deps,
    actor,
  );
}
