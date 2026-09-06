// Whether a planning round's lost artifact can be recovered, and from WHOSE transcript (#1302): keys on the round's newest WORK row (succeeded → recover; open+run-open → wait; open+run-closed → recover, node event may have been eaten #1298; failed → none), scoped to that row's Agent CR name so a multi-round run's scan can't resurface a prior round's result.json. Replaces #1299's blanket "skip while running on an open run" exemption, which hid exactly this incident shape.

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

/** The newest non-human-station station-run row, scanning newest-first; a run predating the clone column (FR6.38) falls back to CR presence to distinguish a human station's row. */
function findWorkRow(
  nodes: readonly RecoveryNode[],
  graph: RunGraph | null,
): RecoveryNode | undefined {
  const nodeTypes = new Map(graph?.nodes.map((n) => [n.id, n.type]) ?? []);

  return [...nodes]
    .reverse()
    .find((row) =>
      graph
        ? !isHumanStation(nodeTypes.get(row.nodeId))
        : row.agentCrName !== null,
    );
}

/** Decide from the run's station-run rows and cloned graph. */
export function decideArtifactRecovery(
  nodes: readonly RecoveryNode[],
  graph: RunGraph | null,
  runOpen: boolean,
): ArtifactRecoveryDecision {
  const workRow = findWorkRow(nodes, graph);

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
