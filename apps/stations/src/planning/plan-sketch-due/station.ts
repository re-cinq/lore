// Sends a plan to the sketch agent only while its Prototype section holds nothing to show: no sketch and no prototype link. Read live, as plan-grounding reads it, since a pass started by hand stores no fresh markdown (see specs/7-feature-planning FR-26).

import {
  defineStation,
  type Handle,
  type Report,
  type RunningStation,
} from "@re-cinq/floor-station";
import { planBlockTypes, type PlanBlockTypes } from "../plan-editor.js";

export interface PlanSketchDueDeps {
  blockTypesOf(planId: string): Promise<PlanBlockTypes>;
}

const PROTOTYPE_SLOT = "prototype";
const DRAWN_BLOCKS = new Set(["mockup", "prototype"]);

const DUE: Report = { outcome: "changes_requested" };
const SETTLED: Report = { outcome: "success" };

/** Whether the plan has a Prototype section and nothing in it a person could look at. */
export function sketchDue(sections: PlanBlockTypes): boolean {
  const prototype = sections.find(({ slot }) => slot === PROTOTYPE_SLOT);

  return Boolean(
    prototype && !prototype.blockTypes.some((type) => DRAWN_BLOCKS.has(type)),
  );
}

export function planSketchDueHandle(deps: PlanSketchDueDeps): Handle {
  return async (brief) =>
    sketchDue(await deps.blockTypesOf(brief.needs.plan_id)) ? DUE : SETTLED;
}

export function startPlanSketchDueStation(): RunningStation {
  return defineStation(
    "plan-sketch-due",
    planSketchDueHandle({ blockTypesOf: planBlockTypes }),
  );
}
