// The run graph's data from the persisted walk rows ALONE — no event stream.
//
// The live panel merges its SSE reducer state over these same rows; a server
// render (the feature card) has no stream, only the rows the Floor wrote. That is
// enough for the current-state graph: a row with an outcome is a step that closed
// with that verdict, an open row is the step working right now, and a node with no
// row at all has not been reached — which run mode draws as pending.

import type { AssemblyLineDefinition } from "./assembly-line-definition";
import type { AssemblyLineRunNode } from "./assembly-line-runs";
import type { RunData } from "./graph-view-model";
import type { NodeRunStatus } from "./run-event-reducer";
import { latestRowByNode } from "./run-replay-view";
import { takenEdgeKeys } from "./run-taken-edges";

function isFailure(outcome: string): boolean {
  return outcome.includes("failed");
}

/** A row's execution status. The badge prefers the verdict, so this only decides
 *  the still-open case — but a failed row must never claim it succeeded. */
function rowStatus(outcome: string | null): NodeRunStatus {
  if (outcome === null) {
    return "running";
  }

  return isFailure(outcome) ? "failed" : "succeeded";
}

/** The run's final token: failed when any step closed failed, completed once the
 *  run itself has finished, and null while it is still going. */
function runResult(anyFailed: boolean, finished: boolean): string | null {
  if (anyFailed) {
    return "failed";
  }

  return finished ? "completed" : null;
}

/** RunData for a run, derived from its walk rows. `finished` is the caller's read
 *  of the run status — the view layer owns that vocabulary. */
export function walkRunData(
  definition: AssemblyLineDefinition | null,
  rows: readonly AssemblyLineRunNode[],
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
