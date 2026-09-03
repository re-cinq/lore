// "Retry this node" fork-and-rerun start (specs/fork-rerun-from-node): retrying node X means naming the visit just before X's latest row, by (nodeId, iteration), exact even on loops/self-edges.
export interface RetryVisit {
  nodeId: string;
  iteration: number;
  outcome: string | null;
}

// The exact visit to name in `resume_from` — the last row of the kept prefix.
export interface RetryResumeSource {
  nodeId: string;
  iteration: number;
}

// Null when no fork exists: the node never ran, it opened the walk, or a visit in the kept prefix is still open.
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
