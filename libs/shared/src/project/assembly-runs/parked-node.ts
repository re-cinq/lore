// Reporting a station outcome to the wait node a line is parked on.
//
// A `wait` node's worker is a person: the author reviewing a planning round, the
// reviewer merging a spec PR. Both report the same way — an `assembly_line.resume`
// event naming the node — so the walk that resumes is the same walk that dispatched
// the work, and the pause is a step in the graph rather than a gap between runs.
//
// This lives here rather than in feature-planning because a parked node is an
// assembly-line fact. It had two would-be owners: lore-api reported the author's
// verdict from inside a route module, and merge-check had no way to report anything
// at all — it minted a fresh task instead, on a predicate that silently stopped
// matching (specs/6-dark-factory FR6.32).

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

/**
 * The row `nodeId` is currently parked on, or null.
 *
 * "Parked" is a row for that node with no outcome yet. The NEWEST such row wins: a
 * revisit mints a new (nodeId, iteration) row, and resuming an older open one would
 * report into a walk that has already passed it.
 */
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

/**
 * The row parked on a HUMAN station of the given type, or null.
 *
 * Joining on the TYPE from the run's own graph — not on a hardcoded node id — is
 * what survives a blueprint rename: the `pr_merged` join died of exactly that (a
 * declared signal nothing matched, FR6.32), and an id constant is the same
 * fragile key wearing a new name. The plain string compare is deliberate: this
 * package cannot import the human-station registry (`libs/assembly-lines`
 * depends on THIS one), and the caller names the type it waits for anyway.
 *
 * `fallbackNodeId` serves runs stamped before clones existed (graph null) —
 * delete it with the other pre-clone fallbacks. Two graph nodes sharing the type
 * resolve to the newest open row, the same rule as `parkedNode`.
 */
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

/**
 * Report a station outcome to a parked node.
 *
 * Deliberately NOT swallowed the way fire-and-forget triggers are: an event that
 * fails to land loses the work, and the caller's 202 would claim it started.
 */
export async function reportToParkedNode(
  reporter: EventReporter,
  target: ParkedTarget,
  outcome: "success" | "changes_requested" | "failed",
  args: Record<string, unknown> = {},
  /**
   * What the worker produced, when it produced more than a decision.
   *
   * A HUMAN station reports an outcome and nothing else, which is why this is
   * optional. A station running in a process produces extras the walk routes on
   * and a failure class that decides whether a failure spends a retry budget —
   * omitting them would advance the walk on a result it cannot read.
   *
   * `unknown`, not `NodeResult`: assembly-lines depends on THIS package, so
   * naming its type here would invert the layering and add a phantom dependency
   * that only resolves because the monorepo hoists. This function's job is to
   * carry the payload; the Floor validates it on receipt (NodeResultSchema),
   * which is where a malformed one must fail anyway — it arrives as JSON from
   * another process, so the sender's type proves nothing about it.
   */
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
