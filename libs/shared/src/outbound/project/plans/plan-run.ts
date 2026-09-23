/** A plan's planning run and whether it is waiting on its people: orchestration over ports, testable without HTTP. */

import { decideRoundDispatch } from "./round-dispatch.js";
import type { AssemblyRuns } from "../assembly-runs/assembly-runs.js";
import type { ParkedTarget } from "../assembly-runs/parked-node.js";
import { planSubject } from "../assembly-runs/subject-keys.js";

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

/** The node a plan's people act on — a Refine or the approval resumes it; parked: null with a runId means the agent is still at work. */
export async function findParkedAuthorNode(
  runs: PlanningRunPort,
  planId: string,
): Promise<ParkedAuthorNode> {
  const lines = await runs.listForSubject(planSubject(planId));
  const line = lines.find((l) => l.blueprintName === PLANNING_DEFINITION);

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
