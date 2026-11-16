// The plan routes' verbs over the floor (ADR-049): each one briefs the round it asks for and hands the plan's markdown to it, then the line verbs report to wherever the run is waiting.

import {
  approvedBrief,
  draftBrief,
  refineBrief,
  sketchBrief,
  type RefineRequest,
} from "./plan-briefs.js";
import {
  askFloorRefine,
  reworkFloorSpec,
  sketchFloorPlan,
  validateFloorPlan,
} from "./floor-plan-by-hand.js";
import { floorPlanLineState } from "@re-cinq/lore-shared/feature-planning/floor-plan-runs.js";
import { reopenWhenAuthorWaits } from "./planning-line.js";
import type {
  PlanContentVerbs,
  PlanSubject,
  PlanVerbs,
} from "./plan-engine.js";
import {
  approveFloorPlan,
  decideFloorApproval,
  keyOf,
  reopenFloorPlan,
  startFloorDrafting,
  startFloorSpecWork,
  type FloorPlanDeps,
  type FloorPlanMarkdown,
} from "./floor-plan-line.js";
import type { PlanSnapshot } from "./plan-file.js";

type SnapshotOf = (plan: PlanSubject) => Promise<PlanSnapshot>;

/** The plan routes' verbs over the floor; the plan is read from where the live plan is, for the verbs that hand it to the run. */
export function floorPlanVerbs(
  deps: FloorPlanDeps,
  snapshotOf: SnapshotOf,
): PlanVerbs {
  return { ...markdownVerbs(deps, snapshotOf), ...lineVerbs(deps) };
}

function markdownVerbs(
  deps: FloorPlanDeps,
  snapshotOf: SnapshotOf,
): PlanContentVerbs {
  // The brief is written FROM the snapshot the run is handed, so what it says of the plan's findings and what the pod downloads are the one read.
  const briefed = async (plan: PlanSubject, briefOf: BriefOf) => {
    const snapshot = await snapshotOf(plan);

    return { plan, ...snapshot, brief: briefOf(snapshot) };
  };

  return {
    ...draftingVerbs(deps, briefed),
    sketch: sketchVerb(deps, briefed),
    ...approvalVerbs(deps, briefed),
  };
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
        await briefed(plan, draftBriefOf(plan, request.known)),
        request.createdBy,
      ),
    refine: async (plan, refine) =>
      askFloorRefine(deps, {
        ...(await briefed(plan, refineBriefOf(plan, refine))),
        refine,
        actor: refine.actor,
      }),
  };
}

/** The sketch agent over a plan still being written: a run opened for it alone is briefed to draw. */
function sketchVerb(
  deps: FloorPlanDeps,
  briefed: Briefed,
): PlanContentVerbs["sketch"] {
  return async (plan, actor) =>
    sketchFloorPlan(deps, {
      ...(await briefed(plan, () => sketchBrief(plan))),
      actor,
    });
}

const draftBriefOf =
  (plan: PlanSubject, known: string): BriefOf =>
  (seen) =>
    draftBrief(plan, known, seen.openFindings);

const refineBriefOf =
  (plan: PlanSubject, refine: RefineRequest): BriefOf =>
  (seen) =>
    refineBrief(plan, refine, seen.openFindings);

/** The two verbs an approved plan's own brief serves: handing it over, and a fresh pass over specs it already has. */
function approvalVerbs(
  deps: FloorPlanDeps,
  briefed: Briefed,
): Pick<PlanContentVerbs, "handOverApproved" | "startSpecWork"> {
  return {
    handOverApproved: async (plan, approvedBy) => {
      await approveFloorPlan(
        deps,
        await briefed(plan, () => approvedBrief(plan)),
        approvedBy,
      );
    },
    startSpecWork: async (plan) =>
      startFloorSpecWork(deps, await briefed(plan, () => approvedBrief(plan))),
  };
}

/** The round's brief, written from the plan as this read found it. */
type BriefOf = (snapshot: PlanSnapshot) => string;

type Briefed = (
  plan: PlanSubject,
  briefOf: BriefOf,
) => Promise<FloorPlanMarkdown>;

function lineVerbs(
  deps: FloorPlanDeps,
): Omit<PlanVerbs, keyof PlanContentVerbs> {
  return {
    approvalDecision: (plan) => decideFloorApproval(deps, plan),
    reopen: (plan, actor) => reopenFloorPlan(deps, plan, actor),
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
