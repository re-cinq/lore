// Where a planning round goes.
//
// A feature's planning is one assembly line whose rounds are revisits (FR6.21), so
// the wizard reports the author's verdict to the node the line is PARKED on rather
// than minting a line per round. Features whose planning started before that line
// existed have no parked node, and must keep the old path or they strand mid-plan.

/** The parked-node facts this decision needs — an `assembly_line_nodes` row. */
export interface ParkedNode {
  nodeId: string;
  iteration: number;
  outcome: string | null;
}

export type RoundDispatch =
  { kind: "resume"; nodeId: string; iteration: number } | { kind: "legacy" };

/** The wait node the planning line parks on between rounds. */
const AUTHOR_NODE = "author";

/**
 * Resume the parked author node when the feature's line is open and waiting;
 * otherwise mint a line the old way.
 *
 * "Waiting" is an author row with no outcome yet. A row that already has one has
 * been reported; completing it again would either be ignored or, worse, advance a
 * walk that has already moved on.
 */
export function decideRoundDispatch(
  status: string | null,
  nodes: readonly ParkedNode[],
): RoundDispatch {
  if (status !== "running" && status !== "queued") {
    return { kind: "legacy" };
  }
  const parked = nodes.find(
    (n) => n.nodeId === AUTHOR_NODE && n.outcome === null,
  );

  return parked
    ? { kind: "resume", nodeId: parked.nodeId, iteration: parked.iteration }
    : { kind: "legacy" };
}
