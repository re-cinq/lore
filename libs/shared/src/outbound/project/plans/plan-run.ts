/** A plan's planning run and whether it is waiting on its people: orchestration over ports, testable without HTTP. */

import { decideRoundDispatch } from "./round-dispatch.js";
import type { AssemblyRuns } from "../assembly-runs/assembly-runs.js";
import type { AssemblyRunRecord } from "../assembly-runs/assembly-runs-port.js";
import {
  parkedHumanNode,
  type ParkedNode,
  type ParkedTarget,
} from "../assembly-runs/parked-node.js";
import { planSubject } from "../assembly-runs/subject-keys.js";
import type { RunGraph } from "../../../domain/run-graph.js";

/** The definition whose line owns a plan from its first draft to its spec-tasks. */
export const PLANNING_DEFINITION = "feature-planning";

export type PlanningRunPort = Pick<
  AssemblyRuns,
  "listForSubject" | "listStationRuns"
>;

export interface ParkedAuthorNode {
  runId: string | null;
  parked: ({ lineId: string } & ParkedTarget) | null;
}

/** Where a plan's newest planning line is: what it waits on, what it delivered, and whether its specs reached main. */
export interface PlanLine {
  lineId: string;
  status: string;
  outcome: string | null;
  /** The spec PR the line opened, once `push` stamped it. */
  prNumber: number | null;
  /** The node the line is on, or null once it ended. */
  open: string | null;
  parkedAuthor: ParkedTarget | null;
  parkedMerged: ParkedTarget | null;
  /** The spec PR merged: the specs this plan produced are on main. */
  merged: boolean;
}

/** The node a plan's people act on — a Refine or the approval resumes it; parked: null with a runId means the agent is still at work. */
export async function findParkedAuthorNode(
  runs: PlanningRunPort,
  planId: string,
): Promise<ParkedAuthorNode> {
  const line = planningLineOf(await runs.listForSubject(planSubject(planId)));

  if (!line) {
    return { runId: null, parked: null };
  }
  const decision = decideRoundDispatch(
    line.status,
    await runs.listStationRuns(line.id),
    line.graph,
  );

  return { runId: line.id, parked: parkedTarget(decision, line.id) };
}

/** The node the dispatch decision parks on, or null when the line is not waiting on its people. */
function parkedTarget(
  decision: ReturnType<typeof decideRoundDispatch>,
  lineId: string,
): ({ lineId: string } & ParkedTarget) | null {
  return decision.kind === "resume"
    ? { nodeId: decision.nodeId, iteration: decision.iteration, lineId }
    : null;
}

const OPEN = new Set(["queued", "running"]);

/** The plan's line: the open planning run when there is one, else the newest. The subject holds one open line at a time, but a newer run can be over while an older one was reopened — reading only the newest then finds nobody waiting. */
function planningLineOf(
  lines: readonly AssemblyRunRecord[],
): AssemblyRunRecord | undefined {
  const planning = lines.filter((l) => l.blueprintName === PLANNING_DEFINITION);

  return planning.find((l) => OPEN.has(l.status)) ?? planning.at(0);
}

const AUTHOR_STATION = { type: "feature_review", fallbackNodeId: "author" };
const MERGED_STATION = { type: "pr_review", fallbackNodeId: "merged" };

/** The plan's newest planning line, or null before one started. Every post-approval decision (approve, reopen, retry) reads this one shape. */
export async function planLineState(
  runs: PlanningRunPort,
  planId: string,
): Promise<PlanLine | null> {
  const line = planningLineOf(await runs.listForSubject(planSubject(planId)));

  if (!line) {
    return null;
  }

  return lineState(line, await runs.listStationRuns(line.id));
}

function lineState(line: AssemblyRunRecord, visits: ParkedNode[]): PlanLine {
  const parked = (station: typeof AUTHOR_STATION) =>
    target(line.id, parkedHumanNode(line.status, visits, line.graph, station));

  return {
    lineId: line.id,
    status: line.status,
    outcome: line.outcome,
    prNumber: prNumberOf(line.args),
    open: openNode(line.status, visits),
    parkedAuthor: parked(AUTHOR_STATION),
    parkedMerged: parked(MERGED_STATION),
    merged: mergedNodeSucceeded(visits, line.graph),
  };
}

function target(lineId: string, node: ParkedNode | null): ParkedTarget | null {
  return node
    ? { lineId, nodeId: node.nodeId, iteration: node.iteration }
    : null;
}

function prNumberOf(args: Record<string, unknown>): number | null {
  return typeof args.pr_number === "number" ? args.pr_number : null;
}

// The newest visit with no outcome is the node the line is on; a closed line is on none, whatever its rows say.
function openNode(status: string, visits: ParkedNode[]): string | null {
  const open = status === "running" || status === "queued";

  return (open && visits.findLast((v) => v.outcome === null)?.nodeId) || null;
}

function mergedNodeSucceeded(
  visits: ParkedNode[],
  graph: RunGraph | null,
): boolean {
  const mergedIds = new Set(
    graph
      ? mergedNodesOf(graph).map((n) => n.id)
      : [MERGED_STATION.fallbackNodeId],
  );

  return visits.some((v) => mergedIds.has(v.nodeId) && v.outcome === "success");
}

function mergedNodesOf(graph: RunGraph): RunGraph["nodes"] {
  return graph.nodes.filter((n) => n.type === MERGED_STATION.type);
}
