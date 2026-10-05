// A spec PR's close, told to the feature-planning run waiting on it: a merge sends the run on to decompose, a close without one ends it. The retry and dead-lettering are the bus's, so a floor out of reach costs a late answer and not a lost one.
import type { EventHandler } from "@re-cinq/lore-shared/project/events/drain-loop.js";
import { decideResumeFromClosedPr } from "@re-cinq/lore-shared/project/assembly-runs/decompose-resume.js";
import {
  visitParkedOnSpecPr,
  type PlanLineFloor,
} from "@re-cinq/lore-shared/feature-planning/floor-plan-runs.js";
import {
  reportToVisit,
  type VisitReporter,
} from "@re-cinq/lore-shared/floor/floor-report.js";

export interface FloorPlanDeps {
  floor(): PlanLineFloor & VisitReporter;
}

export interface ClosedSpecPr {
  repo: string;
  prNumber: number;
  outcome: "success" | "failed";
}

const PR_CLOSED = "github.pull_request.closed";

export const FLOOR_PLAN_EVENTS: readonly string[] = [PR_CLOSED];

export function floorPlanHandlers(
  deps: FloorPlanDeps,
): Map<string, EventHandler> {
  return new Map<string, EventHandler>([[PR_CLOSED, onSpecPrClosed(deps)]]);
}

function onSpecPrClosed(deps: FloorPlanDeps): EventHandler {
  return async (params) => {
    const closed = closedSpecPrOf(params);

    if (!closed) {
      return;
    }
    const floor = deps.floor();
    const parked = await visitParkedOnSpecPr(floor, closed);

    if (parked) {
      await reportToVisit(floor.events, parked.visitId, {
        outcome: closed.outcome,
      });
    }
  };
}

/** The merge is read as the old Floor read it (`decideResumeFromClosedPr`); a close without one is the same PR ending the line, which that decision leaves to the line's failed edge. */
export function closedSpecPrOf(
  params: Record<string, unknown>,
): ClosedSpecPr | null {
  const merged = decideResumeFromClosedPr(params);

  if (merged) {
    return { repo: merged.repo, prNumber: merged.prNumber, outcome: "success" };
  }
  const { repo, pr_number: prNumber } = params;

  return typeof repo === "string" && typeof prNumber === "number"
    ? { repo, prNumber, outcome: "failed" }
    : null;
}
