/** Whether a walk failed overall, derived purely from its recorded node visits. */

import {
  nodeFailureReason,
  type NodeVisit,
  type StageOutcome,
} from "@re-cinq/lore-assembly-lines";

/** True when a later visit of the same node closed non-failed — the retry edge worked, so this failure is history, not the line's verdict. */
function recoveredLater(
  visits: NodeVisit[],
  visit: NodeVisit,
  index: number,
): boolean {
  return visits
    .slice(index + 1)
    .some(
      (later) =>
        later.nodeId === visit.nodeId &&
        later.outcome !== null &&
        !visitFailed(later.outcome),
    );
}

function visitFailed(outcome: StageOutcome | null): boolean {
  if (outcome === null) {
    return false;
  }

  switch (outcome) {
    case "failed":
      return true;
    case "success":
    case "changes_requested":
      return false;
  }
}

/** A walk failed overall if any node failed on the way, even though every definition routes `failed` edges toward exit — "completed" would otherwise render a green check over a failed review. */
export function lineOutcomeFromVisits(visits: NodeVisit[]): {
  outcome: "completed" | "failed";
  reason?: string;
} {
  // The LAST unrecovered failure decides the line — run 52c3fdd5 blamed a retried-and-recovered node instead of the failure that actually routed the walk out.
  const unrecovered = visits.filter(
    (visit, index) =>
      visitFailed(visit.outcome) && !recoveredLater(visits, visit, index),
  );
  const failed = unrecovered.at(-1);

  // Degrades to the old `node "<id>" failed` wording for rows written before migration 0042 (no classification).
  return failed
    ? { outcome: "failed", reason: nodeFailureReason(failed) }
    : { outcome: "completed" };
}
