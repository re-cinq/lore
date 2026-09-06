/** Feature run + author wait state: orchestration over ports, testable without HTTP. */

import { decideRoundDispatch } from "../../feature-planning/round-dispatch.js";
import type { AssemblyRuns } from "../assembly-runs/assembly-runs.js";
import type { ParkedTarget } from "../assembly-runs/parked-node.js";
import { featureSubject } from "../assembly-runs/subject-keys.js";

/** The definition whose line owns a feature's planning for its whole life. */
export const PLANNING_DEFINITION = "feature-planning";

export type PlanningRunPort = Pick<
  AssemblyRuns,
  "listForSubject" | "listStationRuns"
>;

export interface ParkedAuthorNode {
  runId: string | null;
  parked: ({ lineId: string } & ParkedTarget) | null;
}

/** NEWEST run for feature (any blueprint): finished runs show with failure reasons. */
export async function featureRunId(
  runs: PlanningRunPort,
  featureId: string,
): Promise<string | null> {
  const found = await runs.listForSubject(featureSubject(featureId));

  return found[0]?.id ?? null;
}

/** Author-wait node for refinement: parked: null with runId means mid-flight. */
export async function findParkedAuthorNode(
  runs: PlanningRunPort,
  featureId: string,
): Promise<ParkedAuthorNode> {
  const lines = await runs.listForSubject(featureSubject(featureId));
  const line = lines.find((l) => l.blueprintName === PLANNING_DEFINITION);

  if (!line) {
    return { runId: null, parked: null };
  }
  const decision = decideRoundDispatch(
    line.status,
    await runs.listStationRuns(line.id),
    line.graph,
  );

  return {
    runId: line.id,
    parked:
      decision.kind === "resume"
        ? {
            nodeId: decision.nodeId,
            iteration: decision.iteration,
            lineId: line.id,
          }
        : null,
  };
}
