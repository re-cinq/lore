/**
 * When a spec PR merges, resume the line that was waiting for it.
 *
 * This replaces `decideDecomposeKick`, which minted a `feature-decompose` task and
 * fired only for a `feature-finalize` task. The moment finalize became a RESUME of
 * the planning line the owning task became `feature-planning`, the predicate stopped
 * matching, and **no feature planned on the merged line was ever decomposed** —
 * silently, with nothing logged (specs/6-dark-factory FR6.32).
 *
 * Nothing here mints anything. The line parks on a `merged` wait node after `push`,
 * and merging is that node's outcome — reported through exactly the mechanism the
 * author's accept already uses, so there is no second execution path to keep alive.
 */

import type { Pool } from "pg";
import type { AssemblyLinesPort } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-port.js";
import {
  parkedNode,
  reportToParkedNode,
  type ParkedNode,
  type ParkedTarget,
} from "@re-cinq/lore-shared/project/assembly-lines/parked-node.js";

/** The wait node a line parks on while its spec PR is open. */
const MERGED_NODE = "merged";

/** Where to report a merge for one candidate line, or null when it is not waiting
 *  for one. Pure — naming the node in a single place is the point. */
export function decideMergeResume(
  lineId: string,
  status: string | null,
  nodes: readonly ParkedNode[],
): ParkedTarget | null {
  const parked = parkedNode(status, nodes, MERGED_NODE);

  return parked
    ? { lineId, nodeId: parked.nodeId, iteration: parked.iteration }
    : null;
}

export interface DecomposeResumeDeps {
  assemblyLines: Pick<AssemblyLinesPort, "findOpenByPr" | "listNodes">;
  pool: Pool | null;
  /** Seam so a test can record the report without a database. */
  report?: typeof reportToParkedNode;
}

/**
 * Report the merge to whichever open line for this PR is parked on its `merged`
 * node. At most one is: a PR may also carry a code-review line, which has no such
 * node, and inventing a target for it would advance a walk that never asked to wait.
 */
export async function resumeDecomposition(
  pr: { repo: string; prNumber: number },
  deps: DecomposeResumeDeps,
): Promise<void> {
  const open = await deps.assemblyLines.findOpenByPr(pr.repo, pr.prNumber);

  for (const line of open) {
    const target = decideMergeResume(
      line.id,
      line.status,
      await deps.assemblyLines.listNodes(line.id),
    );

    if (!target) {
      continue;
    }

    await (deps.report ?? reportToParkedNode)(
      deps.pool as Pool,
      target,
      "success",
    );

    return;
  }
}
