// Which model judged the diff, asked of the floor: a station's brief does not carry it.
import type { VisitView } from "@re-cinq/floor-client";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";

/** The models that actually billed, from a visit's untyped cost; the model the visit was configured with when it recorded none. */
export function modelsOf(cost: unknown, fallback?: string): string | undefined {
  const names = billedModelNames(cost);

  return names.length > 0 ? names.join(", ") : fallback;
}

function billedModelNames(cost: unknown): string[] {
  const models =
    typeof cost === "object" && cost !== null && "models" in cost
      ? cost.models
      : undefined;

  return typeof models === "object" && models !== null
    ? Object.keys(models)
    : [];
}

/** The agent visit whose output the review was posted from: the latest one that did not fail. */
export function producingVisitOf(visits: VisitView[]): VisitView | undefined {
  return visits
    .filter(
      (visit) =>
        visit.agentSettings !== null && visit.report?.outcome !== "failed",
    )
    .at(-1);
}

/** Fails open: a review without the model line beats no review. */
export async function reviewModelOf(
  visitId: string,
): Promise<string | undefined> {
  try {
    return await lookUpModel(visitId);
  } catch {
    return undefined;
  }
}

async function lookUpModel(visitId: string): Promise<string | undefined> {
  const { stationRuns } = floorClient();
  const posting = await stationRuns.get(visitId);
  const visits = posting ? await stationRuns.list({ run: posting.runId }) : [];
  const agentVisit = producingVisitOf(visits);
  const billed = agentVisit && (await stationRuns.get(agentVisit.id));

  return agentVisit
    ? modelsOf(billed?.cost, agentVisit.agentSettings?.model)
    : undefined;
}
