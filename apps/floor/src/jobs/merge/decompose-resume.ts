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
  /** Deliver the resume. Production binds the pool here so this module never holds
   *  a nullable one it would have to cast away; a test records instead. */
  report: (target: ParkedTarget, outcome: "success") => Promise<void>;
}

/** Bind the pool to the real reporter — the production `report`. */
export function poolReporter(
  pool: Pool,
): DecomposeResumeDeps["report"] {
  return (target, outcome) => reportToParkedNode(pool, target, outcome);
}

/**
 * Report the merge to whichever open line for this PR is parked on its `merged`
 * node.
 *
 * Called for EVERY merged task, not only a feature's — a merged PR is not labelled
 * "this was a spec PR", and the task type that opened it is exactly the signal that
 * stopped being reliable. That is safe because the target is not the PR but a node:
 * only a line actually parked on `merged` qualifies, so an implementation or
 * code-review line sharing the PR is passed over rather than advanced by a walk step
 * it never asked to wait for.
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

    await deps.report(target, "success");

    return;
  }
}
