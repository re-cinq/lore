// The run graph's data AS OF a replay cursor (spec FR4.6b). The final/live view
// reads verdicts and the taken path straight from the persisted walk rows; this
// lens gates each row behind the replayed reducer state, so a verdict becomes
// visible only once the cursor has applied that node-iteration's `result` event.
// The verdict VALUE still comes only from the row — never from the event's
// isError — which preserves the walk-rows-are-authoritative invariant (a review
// pod that exits 0 with a failed verdict reads Failed the moment its result
// event replays, and reads Running before it).

import type { AssemblyLineDefinition } from "./assembly-line-definition";
import type { AssemblyLineRunNode } from "./assembly-line-runs";
import type { NodeRunState } from "./run-event-reducer";
import type { RunData } from "./graph-view-model";
import { takenEdgeKeys } from "./run-taken-edges";

/**
 * The newest walk row per node — max iteration wins regardless of row order, so
 * the pick never depends on the query's ORDER BY. Shared by the final-state run
 * data, the detail card's row pick, and the replay lens below.
 */
export function latestRowByNode(
  rows: readonly AssemblyLineRunNode[],
): Map<string, AssemblyLineRunNode> {
  const latest = new Map<string, AssemblyLineRunNode>();

  for (const row of rows) {
    const prev = latest.get(row.nodeId);

    if (!prev || row.iteration >= prev.iteration) {
      latest.set(row.nodeId, row);
    }
  }

  return latest;
}

function rowCompleted(
  state: NodeRunState | undefined,
  row: AssemblyLineRunNode,
): boolean {
  // An idle node has completed nothing, whatever iteration a replayed
  // non-lifecycle event stamped on it (the reducer raises `iteration` on every
  // event but only leaves "idle" on an init) — so idle never releases a row.
  if (!state || state.status === "idle") {
    return false;
  }

  if (state.iteration > row.iteration) {
    return true;
  }

  return (
    state.iteration === row.iteration &&
    (state.status === "succeeded" || state.status === "failed")
  );
}

/**
 * The walk rows whose completion the replayed state has reached: the node moved
 * past the row's iteration, or sits on it with a terminal status (its `result`
 * event applied). A node still running its row's iteration has not completed it,
 * so the row's outcome may not show yet.
 */
export function completedRowsAt(
  rows: readonly AssemblyLineRunNode[],
  nodeStates: Readonly<Record<string, NodeRunState>>,
): AssemblyLineRunNode[] {
  return rows.filter((row) => rowCompleted(nodeStates[row.nodeId], row));
}

/**
 * RunData as of the replayed state: the taken path and the verdicts grow and
 * shrink with the cursor, a node the replay has not reached disappears from run
 * mode, and `result` stays null so no terminal badge claims an ending mid-replay.
 */
export function replayRunData(
  definition: AssemblyLineDefinition | null,
  rows: readonly AssemblyLineRunNode[],
  nodeStates: Readonly<Record<string, NodeRunState>>,
): RunData {
  const completed = completedRowsAt(rows, nodeStates);
  const entries = Object.entries(nodeStates);
  const verdicts: Record<string, string | null> = {};

  for (const [nodeId, row] of latestRowByNode(completed)) {
    const status = nodeStates[nodeId]?.status;

    if (status === "succeeded" || status === "failed") {
      verdicts[nodeId] = row.outcome;
    }
  }

  return {
    executed: new Set(
      entries
        .filter(([, s]) => s.status !== "idle" || s.transcript.length > 0)
        .map(([id]) => id),
    ),
    verdicts,
    statuses: Object.fromEntries(entries.map(([id, s]) => [id, s.status])),
    taken: takenEdgeKeys(definition, completed),
    result: null,
  };
}
