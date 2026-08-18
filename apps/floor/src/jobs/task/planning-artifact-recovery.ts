// Whether a planning round's lost artifact can be recovered, and from WHOSE
// transcript (#1302).
//
// #1299's blanket exemption — skip recovery whenever the round is `running` on
// an OPEN run — hid exactly the incident shape it existed for: analyze
// SUCCEEDED, the walk parked on `author`, the artifact was lost, and the round
// sat `running` on an open run, permanently exempt. The precise rule keys on
// the round's WORK row (the newest station run a pod actually executed — human
// stations have no pod and no transcript):
//
//   * work row succeeded          → recover, whatever the run's status is
//   * work row open, run open     → in flight; the artifact is not lost yet
//   * work row open, run closed   → recover — the pod may have written the
//                                   artifact and had its node event eaten (#1298)
//   * work row failed             → nothing to recover; a previous round's
//                                   artifact must NOT be replayed into this one
//
// The decision carries the work row's Agent CR name so the transcript scan is
// scoped to THIS round's pod: an unscoped scan over a multi-round run would
// resurface the previous round's `result.json` as if the current round wrote it.

import { isHumanStation } from "@re-cinq/lore-assembly-lines";
import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";

/** The station-run facts the decision reads — a `pipeline.station_runs` row. */
export interface RecoveryNode {
  nodeId: string;
  outcome: string | null;
  agentCrName: string | null;
}

export type ArtifactRecoveryDecision =
  | { kind: "recover"; agentCrName: string | null }
  | { kind: "wait" }
  | { kind: "none" };

/**
 * Decide from the run's station-run rows (visit order) and its cloned graph.
 *
 * A run with no graph predates the clone column (FR6.38); there the work-row
 * test falls back to CR presence — a human station's row never names an Agent
 * CR, a pod's always does.
 */
export function decideArtifactRecovery(
  nodes: readonly RecoveryNode[],
  graph: RunGraph | null,
  runOpen: boolean,
): ArtifactRecoveryDecision {
  const nodeTypes = new Map(graph?.nodes.map((n) => [n.id, n.type]) ?? []);
  const workRow = [...nodes]
    .reverse()
    .find((row) =>
      graph
        ? !isHumanStation(nodeTypes.get(row.nodeId))
        : row.agentCrName !== null,
    );

  if (!workRow) {
    return { kind: "none" };
  }

  if (workRow.outcome === "success") {
    return { kind: "recover", agentCrName: workRow.agentCrName };
  }

  if (workRow.outcome === null) {
    return runOpen
      ? { kind: "wait" }
      : { kind: "recover", agentCrName: workRow.agentCrName };
  }

  return { kind: "none" };
}
