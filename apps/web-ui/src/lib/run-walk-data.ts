// Run graph from walk rows only; live panel merges SSE state over the same rows.

import type { AssemblyLineDefinition } from "./assembly-line-definition";
import type { AssemblyRunNode } from "./assembly-runs";
import type { RunData } from "./graph-view-model";
import type { NodeRunStatus } from "./run-event-reducer";
import { latestRowByNode } from "./run-replay-view";
import { takenEdgeKeys } from "./run-taken-edges";

function isFailure(outcome: string): boolean {
  return outcome.includes("failed");
}

/** A row's execution status. */
function rowStatus(outcome: string | null): NodeRunStatus {
  if (outcome === null) {
    return "running";
  }

  return isFailure(outcome) ? "failed" : "succeeded";
}

/** The run's final token: failed/completed/null. */
function runResult(anyFailed: boolean, finished: boolean): string | null {
  if (anyFailed) {
    return "failed";
  }

  return finished ? "completed" : null;
}

/** RunData derived from walk rows; finished status owned by caller. */
export function walkRunData(
  definition: AssemblyLineDefinition | null,
  rows: readonly AssemblyRunNode[],
  finished: boolean,
): RunData {
  const latest = latestRowByNode(rows);
  const verdicts: Record<string, string | null> = {};
  const statuses: Record<string, NodeRunStatus> = {};

  for (const [nodeId, row] of latest) {
    verdicts[nodeId] = row.outcome;
    statuses[nodeId] = rowStatus(row.outcome);
  }

  return {
    executed: new Set(latest.keys()),
    verdicts,
    statuses,
    taken: takenEdgeKeys(definition, rows),
    result: runResult(
      [...latest.values()].some(
        (row) => row.outcome !== null && isFailure(row.outcome),
      ),
      finished,
    ),
  };
}
