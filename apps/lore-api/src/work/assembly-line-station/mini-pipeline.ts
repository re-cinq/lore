// The mini pipeline: every graph node in definition order, colored by its latest station-run visit.
import { z } from "zod";

export interface PipelineVisit {
  nodeId: string;
  iteration: number;
  outcome: string | null;
}

/** One node of a run, in graph order — the mini pipeline's dot. */
export const PipelineNodeSchema = z.object({
  node_id: z.string(),
  /** success | failed | changes_requested | running | waiting | pending */
  state: z.string(),
});

export type PipelineNode = z.infer<typeof PipelineNodeSchema>;

export function miniPipeline(
  nodes: readonly { id: string; type: string }[],
  visits: readonly PipelineVisit[],
): PipelineNode[] {
  const latest = latestVisitByNode(visits);

  return nodes.map((node) => nodeState(node, latest.get(node.id)));
}

/** One visit per node standing for its latest iteration: the pods of a fan-out run at once, so they read as one, running while any is open, failed once all have reported and one did not succeed. */
function latestVisitByNode(
  visits: readonly PipelineVisit[],
): Map<string, PipelineVisit> {
  const byNode = new Map<string, PipelineVisit[]>();

  for (const visit of visits) {
    byNode.set(visit.nodeId, [...(byNode.get(visit.nodeId) ?? []), visit]);
  }

  return new Map(
    [...byNode].map(([nodeId, all]) => [nodeId, standingFor(latestRound(all))]),
  );
}

function latestRound(all: readonly PipelineVisit[]): PipelineVisit[] {
  const newest = Math.max(...all.map((visit) => visit.iteration));

  return all.filter((visit) => visit.iteration === newest);
}

function standingFor(round: readonly PipelineVisit[]): PipelineVisit {
  const [first] = round as [PipelineVisit, ...PipelineVisit[]];
  const open = round.some((visit) => visit.outcome === null);
  const unsuccessful = round.find((visit) => visit.outcome !== "success");

  return {
    nodeId: first.nodeId,
    iteration: first.iteration,
    outcome: open ? null : (unsuccessful?.outcome ?? "success"),
  };
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
