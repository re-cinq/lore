// The two plan verbs that ask the floor for one node by hand (ADR-049): the validate station over a draft, and the spec writer again while its PR waits. Each posts the start event the node declares and answers with the run it asked.

import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { floorPlanLineState } from "@re-cinq/lore-shared/feature-planning/floor-plan-runs.js";
import {
  keyOf,
  type FloorPlanDeps,
  type PlanFloor,
} from "./floor-plan-line.js";
import type { PlanSubject } from "./plan-engine.js";
import { assertValidatable } from "./plan-validate.js";
import {
  SPEC_PR_NOT_WAITING,
  assertReworkable,
  gatherOpenReview,
} from "./spec-rework.js";

const VALIDATE_EVENT = "manual.plan.validate";
const REWRITE_EVENT = "node.write.start";

export interface FloorPlanAsk {
  plan: PlanSubject;
  actor: string;
}

/** Runs the validate station over a draft plan parked on its author: the start event its node declares. The run's id. */
export async function validateFloorPlan(
  deps: FloorPlanDeps,
  { plan, actor }: FloorPlanAsk,
): Promise<string> {
  const line = await floorPlanLineState(deps.floor, keyOf(plan));

  assertValidatable(plan, line);

  return askNode(deps.floor, {
    event: VALIDATE_EVENT,
    runId: line.lineId,
    actor,
  });
}

/** Runs the spec writer again in the same run while it waits on the spec PR: the floor cancels the open `merged` visit and reopens it afterwards. The run's id. */
export async function reworkFloorSpec(
  deps: FloorPlanDeps,
  { plan, actor }: FloorPlanAsk,
): Promise<string> {
  const line = await floorPlanLineState(deps.floor, keyOf(plan));

  enforceTrue(line !== null, apiError(409), SPEC_PR_NOT_WAITING);
  await gatherOpenReview(deps.pulls, assertReworkable(plan, line));

  return askNode(deps.floor, {
    event: REWRITE_EVENT,
    runId: line.lineId,
    actor,
  });
}

interface NodeAsk {
  event: string;
  runId: string;
  actor: string;
}

async function askNode(
  floor: Pick<PlanFloor, "events">,
  { event, runId, actor }: NodeAsk,
): Promise<string> {
  await floor.events.post({
    name: event,
    payload: { runId, requestedBy: actor },
  });

  return runId;
}
