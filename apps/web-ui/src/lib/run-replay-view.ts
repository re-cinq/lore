// Run graph data as of a replay cursor (spec FR4.6b); verdicts gate on replayed state; walk rows stay authoritative (not event.isError).

import type { AssemblyLineDefinition } from "./assembly-line-definition";
import type { AssemblyRunNode } from "./assembly-runs";
import type { NodeRunState } from "./run-event-reducer";
import type { RunData } from "./graph-view-model";
import { takenEdgeKeys } from "./run-taken-edges";

/** Newest walk row per node; max iteration wins regardless of ORDER BY; shared by final-state and replay lens. */
export function latestRowByNode(
  rows: readonly AssemblyRunNode[],
): Map<string, AssemblyRunNode> {
  const latest = new Map<string, AssemblyRunNode>();

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
  row: AssemblyRunNode,
): boolean {
  // Idle nodes never complete rows; reducer stamps iteration but leaves status idle on non-lifecycle events.
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

/** Walk rows whose completion the replayed state has reached; node past row's iteration or sits on it with terminal status. */
export function completedRowsAt(
  rows: readonly AssemblyRunNode[],
  nodeStates: Readonly<Record<string, NodeRunState>>,
): AssemblyRunNode[] {
  return rows.filter((row) => rowCompleted(nodeStates[row.nodeId], row));
}

/** RunData as of replayed state; path and verdicts grow/shrink with cursor; result stays null mid-replay (no terminal badge). */
export function replayRunData(
  definition: AssemblyLineDefinition | null,
  rows: readonly AssemblyRunNode[],
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
