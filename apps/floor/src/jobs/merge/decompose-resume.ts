/**
 * When a spec PR merges, resume the line that was waiting for it.
 *
 * This replaces `decideDecomposeKick`, which minted a `feature-decompose` task and
 * fired only for a separate finalize task. The moment the accept became a RESUME of
 * the planning line the owning task became `feature-planning`, the predicate stopped
 * matching, and **no feature planned on the merged line was ever decomposed** —
 * silently, with nothing logged (specs/6-dark-factory FR6.32).
 *
 * Nothing here mints anything. The line parks on a `merged` wait node after `push`,
 * and merging is that node's outcome — reported through exactly the mechanism the
 * author's accept already uses, so there is no second execution path to keep alive.
 */

import type { EventReporter } from "@re-cinq/lore-shared/project/events/event-queue-port.js";
import type { AssemblyRunsPort } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";
import {
  parkedHumanNode,
  reportToParkedNode,
  type ParkedNode,
  type ParkedTarget,
} from "@re-cinq/lore-shared/project/assembly-runs/parked-node.js";

/** The spec-PR park is a `pr_review` station, located by TYPE from the run's own
 *  graph — a renamed wait node keeps resuming (the pr_merged join died of a
 *  hardcoded key exactly like this, FR6.32). */
const MERGED_STATION_TYPE = "pr_review";

/** The pre-clone fallback only: the node id pushed lines parked on before runs
 *  carried their graph. */
const MERGED_NODE = "merged";

/** Where to report a merge for one candidate line, or null when it is not waiting
 *  for one. Pure — naming the station type in a single place is the point. */
export function decideMergeResume(
  lineId: string,
  status: string | null,
  nodes: readonly ParkedNode[],
  graph: RunGraph | null,
): ParkedTarget | null {
  const parked = parkedHumanNode(
    status,
    nodes,
    graph,
    MERGED_STATION_TYPE,
    MERGED_NODE,
  );

  return parked
    ? { lineId, nodeId: parked.nodeId, iteration: parked.iteration }
    : null;
}

/**
 * Whether a closed-PR event should resume a line, and for which PR. Pure.
 *
 * The resume used to hang off `handleMergedTask`, which the mergeable sweep only
 * reaches for a task whose OWN row carries a PR (`status IN ('pr-created','review')
 * AND pr_number IS NOT NULL`). A feature-planning task is `running` and carries
 * none — the push node stamps the LINE's args, which is what `findOpenByPr` reads —
 * so no spec PR ever reached the resume, on any deployment. Reading the merge off
 * the event itself needs no task row at all.
 *
 * An unmerged close is deliberately not a resume: it settles the line rather than
 * advancing it into decomposition.
 */
export function decideResumeFromClosedPr(
  params: Record<string, unknown>,
): { repo: string; prNumber: number } | null {
  const repo = params.repo;
  const prNumber = params.pr_number;

  if (params.merged !== true) {
    return null;
  }

  if (typeof repo !== "string" || typeof prNumber !== "number") {
    return null;
  }

  return { repo, prNumber };
}

export interface DecomposeResumeDeps {
  assemblyRuns: Pick<AssemblyRunsPort, "findOpenByPr" | "listStationRuns">;
  /** Deliver the resume. Production binds the event reporter here so this module
   *  never holds one it would have to resolve itself; a test records instead. */
  report: (target: ParkedTarget, outcome: "success") => Promise<void>;
}

/** Bind the event reporter — the production `report`. */
export function eventReport(
  reporter: EventReporter,
): DecomposeResumeDeps["report"] {
  return (target, outcome) => reportToParkedNode(reporter, target, outcome);
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
  const open = await deps.assemblyRuns.findOpenByPr(pr.repo, pr.prNumber);

  for (const line of open) {
    const target = decideMergeResume(
      line.id,
      line.status,
      await deps.assemblyRuns.listStationRuns(line.id),
      line.graph,
    );

    if (!target) {
      continue;
    }

    await deps.report(target, "success");

    return;
  }
}
