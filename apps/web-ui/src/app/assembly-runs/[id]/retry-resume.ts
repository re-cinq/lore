// "Retry this node" → the fork-and-rerun start (specs/fork-rerun-from-node).
//
// The port's `resumeFrom` copies the source run's rows through a named visit,
// and the walk resumes at its successor. So retrying node X means naming the
// visit just before X's latest row — by (nodeId, iteration), which stays exact
// on looping lines where the predecessor node ran again later (or IS the
// retried node, on a self-edge). This module owns that mapping, so the button
// and its gating cannot disagree about when a retry is offered.

/** The slice of a visit row the mapping reads — structural, so the panel's
 *  `AssemblyRunNode` satisfies it without importing the server-side data lib. */
export interface RetryVisit {
  nodeId: string;
  iteration: number;
  outcome: string | null;
}

/** The exact visit to name in `resume_from` — the last row of the kept prefix. */
export interface RetryResumeSource {
  nodeId: string;
  iteration: number;
}

/**
 * The visit to name in `resume_from` when retrying `nodeId`, or null when no
 * fork exists: the node never ran, it opened the walk (no prefix to keep), or
 * a visit in the kept prefix is still open.
 */
export function retryResumeSource(
  visits: readonly RetryVisit[],
  nodeId: string,
): RetryResumeSource | null {
  const targetIndex = visits.findLastIndex((v) => v.nodeId === nodeId);

  if (targetIndex <= 0) {
    return null;
  }
  const prefix = visits.slice(0, targetIndex);

  if (prefix.some((v) => v.outcome === null)) {
    return null;
  }
  const source = prefix[prefix.length - 1];

  return { nodeId: source.nodeId, iteration: source.iteration };
}
