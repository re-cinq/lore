/**
 * Which assembly run a feature is on, and whether it is waiting on its author.
 *
 * Extracted from the feature routes. It is orchestration over ports rather than
 * anything about HTTP — the route was carrying it only because that is where it
 * was first needed — and the planning lifecycle has produced enough
 * silent-channel defects to be worth testing without a server in front of it.
 */

import { decideRoundDispatch } from "../../feature-planning/round-dispatch.js";
import type { AssemblyRuns } from "../assembly-runs/assembly-runs.js";
import type { ParkedTarget } from "../assembly-runs/parked-node.js";
import { featureSubject } from "../assembly-runs/subject-keys.js";

/** The definition whose line owns a feature's planning for its whole life. */
export const PLANNING_DEFINITION = "feature-planning";

/** What resolving a feature's run needs, and nothing more. */
export type PlanningRunPort = Pick<
  AssemblyRuns,
  "listForSubject" | "listStationRuns"
>;

export interface ParkedAuthorNode {
  runId: string | null;
  parked: ({ lineId: string } & ParkedTarget) | null;
}

/**
 * The run the feature page draws: the NEWEST run for this feature, whatever
 * blueprint it is — filtering to the planning definition hid the finalize run,
 * so "Create spec PR" looked like nothing happened. Newest, not newest-OPEN: a
 * finished run must still show, failure reason and all.
 */
export async function featureRunId(
  runs: PlanningRunPort,
  featureId: string,
): Promise<string | null> {
  const found = await runs.listForSubject(featureSubject(featureId));

  return found[0]?.id ?? null;
}

/**
 * The node a refinement reports to, when the line is waiting on the author.
 *
 * `parked: null` with a `runId` means the line is mid-flight — a refusal the
 * caller must make BEFORE writing a round row, or a refused refine leaves a
 * round nothing will ever run.
 */
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
