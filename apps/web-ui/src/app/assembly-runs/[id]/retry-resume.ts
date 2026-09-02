// "Retry this node" → the fork-and-rerun start (specs/fork-rerun-from-node).
//
// The port's `resumeFrom` is node-granular: it copies the source run's rows
// through the NAMED node's latest completed visit, and the walk resumes at its
// successor. So retrying node X means naming the visit just before X's latest
// row — and the mapping is only exact when that predecessor never ran again
// later. This module owns that mapping, so the button and its gating cannot
// disagree about when a retry is offered.

/** The slice of a visit row the mapping reads — structural, so the panel's
 *  `AssemblyRunNode` satisfies it without importing the server-side data lib. */
export interface RetryVisit {
  nodeId: string;
  outcome: string | null;
}

/**
 * The node to name in `resume_from` when retrying `nodeId`, or null when no
 * exact fork exists: the node never ran, it opened the walk (no prefix to
 * keep), a visit in the kept prefix is still open, or the preceding node ran
 * again later (naming it would keep MORE than the prefix before the retry
 * target).
 */
export function retryResumeSource(
  visits: readonly RetryVisit[],
  nodeId: string,
): string | null {
  const targetIndex = visits.findLastIndex((v) => v.nodeId === nodeId);

  if (targetIndex <= 0) {
    return null;
  }
  const prefix = visits.slice(0, targetIndex);

  if (prefix.some((v) => v.outcome === null)) {
    return null;
  }
  const source = prefix[prefix.length - 1];
  const sourceRanAgainLater = visits
    .slice(targetIndex + 1)
    .some((v) => v.nodeId === source.nodeId);

  return sourceRanAgainLater ? null : source.nodeId;
}
