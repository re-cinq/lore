// Whether a run can be routed through the graph at all: specs/7-feature-planning FR-20.

import {
  outcomesLeaving,
  problem,
  stationOf,
  type Checked,
  type Node,
  type PipelineProblem,
  type Station,
} from "./pipeline-lint-shape.js";

// A station picks its outgoing edge from its OWN outcome, so two on one outcome have no tie-break.
export function ambiguousEdges(checked: Checked): PipelineProblem[] {
  const seen = new Map<string, number>();

  for (const edge of checked.line.edges) {
    const key = `${edge.from}\n${edge.on ?? ""}`;

    seen.set(key, (seen.get(key) ?? 0) + 1);
  }

  return [...seen]
    .filter(([, count]) => count > 1)
    .map(([key]) => key.split("\n"))
    .map(([from, outcome]) =>
      problem(checked, from, "ambiguous-edge", ambiguousDetail(outcome)),
    );
}

function ambiguousDetail(outcome: string | undefined): string {
  return `two edges leave it on ${outcome}; a station reads its own outcome, never the verdict of the node that reached it`;
}

// An outcome no edge routes is a run that stops where nobody said it should.
export function unroutedOutcomes(
  checked: Checked,
  node: Node,
  station: Station,
): PipelineProblem[] {
  const unrouted = unroutedOf(checked, node, station);

  return unrouted.length === 0
    ? []
    : [
        problem(
          checked,
          node.id,
          "outcome-without-edge",
          unroutedDetail(unrouted),
        ),
      ];
}

function unroutedOf(checked: Checked, node: Node, station: Station): string[] {
  const routed = outcomesLeaving(checked, node.id);

  return routed.has("always")
    ? []
    : station.outcomes.filter((outcome) => !routed.has(outcome));
}

function unroutedDetail(unrouted: string[]): string {
  const what = unrouted.length === 1 ? "that outcome" : "those outcomes";

  return `declares ${unrouted.join(", ")} and no edge leaves it on ${what}`;
}

// An edge on an outcome its station never produces is a route nothing can take.
export function undeclaredOutcomes(checked: Checked): PipelineProblem[] {
  const { edges } = checked.line;

  return edges
    .filter((edge) => edge.on !== undefined && edge.on !== "always")
    .filter((edge) => !declares(checked, edge.from, edge.on))
    .map((edge) =>
      problem(
        checked,
        edge.from,
        "undeclared-outcome",
        `an edge leaves it on ${edge.on}, which its station does not declare`,
      ),
    );
}

function declares(
  checked: Checked,
  nodeId: string,
  outcome: string | undefined,
): boolean {
  const { nodes } = checked.line;
  const node = nodes.find((each) => each.id === nodeId);
  const station = node ? stationOf(checked, node) : undefined;

  return !station || station.outcomes.length === 0
    ? true
    : station.outcomes.includes(outcome ?? "");
}

// A node a run can enter and never leave.
export function deadEnds(checked: Checked): PipelineProblem[] {
  const { nodes, exit } = checked.line;

  return nodes
    .filter((node) => node.id !== exit)
    .filter((node) => outcomesLeaving(checked, node.id).size === 0)
    .map((node) =>
      problem(
        checked,
        node.id,
        "dead-end",
        "no edge leaves it and it is not the line's exit, so a run reaching it stops with nothing to do",
      ),
    );
}

// A node no run ever visits.
export function unreachableNodes(checked: Checked): PipelineProblem[] {
  const reached = reachableFrom(checked);
  const { nodes } = checked.line;

  return nodes
    .filter((node) => !reached.has(node.id))
    .map((node) =>
      problem(
        checked,
        node.id,
        "unreachable",
        "no edge and no start event reaches it, so no run ever visits it",
      ),
    );
}

/** From the entry, and from every node a person may start by hand. */
function reachableFrom(checked: Checked): Set<string> {
  const { nodes, entry, edges } = checked.line;
  const pending = [
    entry,
    ...nodes.filter((node) => node.start).map((node) => node.id),
  ].filter((nodeId) => nodeId.length > 0);
  const seen = new Set<string>();

  while (pending.length > 0) {
    const nodeId = pending.pop() as string;

    if (!seen.has(nodeId)) {
      seen.add(nodeId);
      pending.push(
        ...edges.filter((edge) => edge.from === nodeId).map((edge) => edge.to),
      );
    }
  }

  return seen;
}
