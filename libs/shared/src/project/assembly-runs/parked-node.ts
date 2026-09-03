// Reports a station outcome to the wait node a line is parked on. A wait node's worker is a person (author, reviewer); both report the same way (an assembly_line.resume event naming the node), so the pause is a graph step, not a gap between runs. Lives here (not feature-planning) since a parked node is an assembly-line fact — merge-check used to mint a fresh task instead, on a predicate that silently stopped matching (specs/6-dark-factory FR6.32).

import type { EventReporter } from "../events/event-queue-port.js";
import { RUN_RESUME_EVENT } from "./run-events.js";
import type { RunGraph } from "./run-graph.js";

/** The parked-node facts a caller needs — an `assembly_line_nodes` row. */
export interface ParkedNode {
  nodeId: string;
  iteration: number;
  outcome: string | null;
}

/** A line that can still be resumed. A terminal line's node rows are history. */
const OPEN_STATUSES = new Set(["running", "queued"]);

/** The row nodeId is currently parked on, or null. "Parked" = a row for that node with no outcome yet; the newest such row wins, since a revisit mints a new row and an older open one has already been passed by the walk. */
export function parkedNode(
  status: string | null,
  nodes: readonly ParkedNode[],
  nodeId: string,
): ParkedNode | null {
  if (!status || !OPEN_STATUSES.has(status)) {
    return null;
  }

  return (
    [...nodes]
      .reverse()
      .find((n) => n.nodeId === nodeId && n.outcome === null) ?? null
  );
}

/** The row parked on a human station of the given type, or null. Joins on TYPE from the run's own graph, not a hardcoded node id — an id constant is the fragile key that killed the pr_merged join (FR6.32). fallbackNodeId serves pre-clone runs (graph null); delete it with the other pre-clone fallbacks. */
export function parkedHumanNode(
  status: string | null,
  nodes: readonly ParkedNode[],
  graph: RunGraph | null,
  humanType: string,
  fallbackNodeId: string,
): ParkedNode | null {
  if (!graph) {
    return parkedNode(status, nodes, fallbackNodeId);
  }

  if (!status || !OPEN_STATUSES.has(status)) {
    return null;
  }
  const typedIds = new Set(
    graph.nodes.filter((n) => n.type === humanType).map((n) => n.id),
  );

  return (
    [...nodes]
      .reverse()
      .find((n) => typedIds.has(n.nodeId) && n.outcome === null) ?? null
  );
}

/** Where to report, and what the walk should do next. */
export interface ParkedTarget {
  lineId: string;
  nodeId: string;
  iteration: number;
}

/** Reports a station outcome to a parked node; deliberately not swallowed like fire-and-forget triggers — a lost event would lose the work while the caller's 202 claimed it started. */
export async function reportToParkedNode(
  reporter: EventReporter,
  target: ParkedTarget,
  outcome: "success" | "changes_requested" | "failed",
  args: Record<string, unknown> = {},
  /** What the worker produced beyond a decision; optional since a human station reports only an outcome. `unknown`, not NodeResult, since assembly-lines depends on this package — the Floor validates it on receipt (NodeResultSchema). */
  result?: unknown,
): Promise<void> {
  await reporter.insert({
    eventName: RUN_RESUME_EVENT,
    source: "internal",
    params: {
      assemblyLineId: target.lineId,
      nodeId: target.nodeId,
      iteration: target.iteration,
      outcome,
      args,
      ...(result ? { result } : {}),
    },
  });
}
