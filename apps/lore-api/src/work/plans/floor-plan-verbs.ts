// The plan routes' verbs over the floor (ADR-049): each one briefs the round it asks for and hands the plan's markdown to it, then the line verbs report to wherever the run is waiting.

import { approvedBrief, draftBrief, refineBrief } from "./plan-briefs.js";
import { floorPlanLineState } from "@re-cinq/lore-shared/feature-planning/floor-plan-runs.js";
import { reopenWhenAuthorWaits } from "./planning-line.js";
import type {
  PlanContentVerbs,
  PlanSubject,
  PlanVerbs,
} from "./plan-engine.js";
import {
  approveFloorPlan,
  askFloorRefine,
  decideFloorApproval,
  keyOf,
  reopenFloorPlan,
  reworkFloorSpec,
  startFloorDrafting,
  startFloorSpecWork,
  validateFloorPlan,
  type FloorPlanDeps,
  type FloorPlanMarkdown,
} from "./floor-plan-line.js";

/** The plan routes' verbs over the floor; the plan's markdown is read from where the live plan is, for the verbs that hand it to the run. */
export function floorPlanVerbs(
  deps: FloorPlanDeps,
  markdownOf: (planId: string) => Promise<string>,
): PlanVerbs {
  return { ...markdownVerbs(deps, markdownOf), ...lineVerbs(deps) };
}

function markdownVerbs(
  deps: FloorPlanDeps,
  markdownOf: (planId: string) => Promise<string>,
): PlanContentVerbs {
  const briefed = async (plan: PlanSubject, brief: string) => ({
    plan,
    planMarkdown: await markdownOf(plan.id),
    brief,
  });

  return { ...draftingVerbs(deps, briefed), ...approvalVerbs(deps, briefed) };
}

/** The two verbs a plan still being written serves: the draft, and one section's Refine. */
function draftingVerbs(
  deps: FloorPlanDeps,
  briefed: Briefed,
): Pick<PlanContentVerbs, "draft" | "refine"> {
  return {
    draft: async (plan, request) =>
      startFloorDrafting(
        deps,
        await briefed(plan, draftBrief(plan, request.known)),
      ),
    refine: async (plan, refine) =>
      askFloorRefine(deps, {
        ...(await briefed(plan, refineBrief(plan, refine))),
        refine,
      }),
  };
}

/** The two verbs an approved plan's own brief serves: handing it over, and a fresh pass over specs it already has. */
function approvalVerbs(
  deps: FloorPlanDeps,
  briefed: Briefed,
): Pick<PlanContentVerbs, "handOverApproved" | "startSpecWork"> {
  return {
    handOverApproved: async (plan) => {
      await approveFloorPlan(deps, await briefed(plan, approvedBrief(plan)));
    },
    startSpecWork: async (plan) =>
      startFloorSpecWork(deps, await briefed(plan, approvedBrief(plan))),
  };
}

type Briefed = (plan: PlanSubject, brief: string) => Promise<FloorPlanMarkdown>;

function lineVerbs(
  deps: FloorPlanDeps,
): Omit<PlanVerbs, keyof PlanContentVerbs> {
  return {
    approvalDecision: (plan) => decideFloorApproval(deps, plan),
    reopen: (plan) => reopenFloorPlan(deps, plan),
    openForAuthor: async (plan, reopen) =>
      reopenWhenAuthorWaits(
        await floorPlanLineState(deps.floor, keyOf(plan)),
        plan,
        reopen,
      ),
    reworkSpec: (plan, actor) => reworkFloorSpec(deps, { plan, actor }),
    validate: (plan, actor) => validateFloorPlan(deps, { plan, actor }),
  };
}
