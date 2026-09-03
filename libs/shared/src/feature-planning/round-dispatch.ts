// Planning rounds are revisits of one parked node (FR6.21); pre-existing features with no parked node keep the legacy path.

import {
  parkedHumanNode,
  type ParkedNode,
} from "../project/assembly-runs/parked-node.js";
import type { RunGraph } from "../project/assembly-runs/run-graph.js";

export type { ParkedNode };

export type RoundDispatch =
  { kind: "resume"; nodeId: string; iteration: number } | { kind: "legacy" };

// Located by TYPE, not id, so renaming the node in feature-planning.yaml can't silently kill the resume (FR6.32).
const AUTHOR_STATION_TYPE = "feature_review";

// Pre-clone fallback only: the node id the planning line parked on before runs carried their graph.
const AUTHOR_NODE = "author";

// Resumes the parked author node when open; else mints a line the legacy way (parked-ness itself is `parkedHumanNode`'s call, shared with spec-PR reporting).
export function decideRoundDispatch(
  status: string | null,
  nodes: readonly ParkedNode[],
  graph: RunGraph | null,
): RoundDispatch {
  const parked = parkedHumanNode(
    status,
    nodes,
    graph,
    AUTHOR_STATION_TYPE,
    AUTHOR_NODE,
  );

  return parked
    ? { kind: "resume", nodeId: parked.nodeId, iteration: parked.iteration }
    : { kind: "legacy" };
}
