// Where a planning round goes.
//
// A feature's planning is one assembly line whose rounds are revisits (FR6.21), so
// the wizard reports the author's verdict to the node the line is PARKED on rather
// than minting a line per round. Features whose planning started before that line
// existed have no parked node, and must keep the old path or they strand mid-plan.

import {
  parkedNode,
  type ParkedNode,
} from "../project/assembly-lines/parked-node.js";

export type { ParkedNode };

export type RoundDispatch =
  { kind: "resume"; nodeId: string; iteration: number } | { kind: "legacy" };

/** The wait node the planning line parks on between rounds. */
const AUTHOR_NODE = "author";

/**
 * Resume the parked author node when the feature's line is open and waiting;
 * otherwise mint a line the old way.
 *
 * What counts as parked belongs to the assembly line, not to feature planning —
 * the same rule decides whether a merged spec PR can be reported — so it lives in
 * `parkedNode`. What is feature-planning-specific is the FALLBACK: a feature whose
 * planning predates the merged line has no parked node and must keep the old path
 * or it strands mid-plan.
 */
export function decideRoundDispatch(
  status: string | null,
  nodes: readonly ParkedNode[],
): RoundDispatch {
  const parked = parkedNode(status, nodes, AUTHOR_NODE);

  return parked
    ? { kind: "resume", nodeId: parked.nodeId, iteration: parked.iteration }
    : { kind: "legacy" };
}
