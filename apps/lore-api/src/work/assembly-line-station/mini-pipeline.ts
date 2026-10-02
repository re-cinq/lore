// The mini pipeline: every graph node in definition order, colored by its latest station-run visit.

export interface PipelineVisit {
  nodeId: string;
  iteration: number;
  outcome: string | null;
}

export interface PipelineNode {
  node_id: string;
  state: string;
}

export function miniPipeline(
  nodes: readonly { id: string; type: string }[],
  visits: readonly PipelineVisit[],
): PipelineNode[] {
  const latest = latestVisitByNode(visits);

  return nodes.map((node) => nodeState(node, latest.get(node.id)));
}

/** Latest visit per node, later iterations winning over earlier ones. */
function latestVisitByNode(
  visits: readonly PipelineVisit[],
): Map<string, PipelineVisit> {
  const latest = new Map<string, PipelineVisit>();

  for (const visit of visits) {
    const prior = latest.get(visit.nodeId);

    if (!prior || visit.iteration >= prior.iteration) {
      latest.set(visit.nodeId, visit);
    }
  }

  return latest;
}

/** Node types whose open row means "parked", not "working": a person, or a build, owns the next move. Mirrors HUMAN_STATION_TYPES, which lore-api does not depend on. */
const WAITING_NODE_TYPES = new Set(["pr_review", "ci_check"]);

/** absent = pending, open = running/waiting for a human station. */
function nodeState(
  node: { id: string; type: string },
  visit: PipelineVisit | undefined,
): PipelineNode {
  if (!visit) {
    return { node_id: node.id, state: "pending" };
  }

  if (visit.outcome === null) {
    return {
      node_id: node.id,
      state: WAITING_NODE_TYPES.has(node.type) ? "waiting" : "running",
    };
  }

  return { node_id: node.id, state: visit.outcome };
}
