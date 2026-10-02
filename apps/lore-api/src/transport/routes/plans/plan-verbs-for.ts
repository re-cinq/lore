import { floorPlanVerbs } from "../../../work/plans/floor-plan-verbs.js";
import { floorIfConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { projectFor } from "../../../outbound/project-boot.js";
import {
  type FloorPlanDeps,
  type PlanFloor,
} from "../../../work/plans/floor-plan-line.js";
import type {
  PlanSubject,
  PlanVerbs,
} from "../../../work/plans/plan-engine.js";
import {
  planMarkdown,
  type PlanFilePorts,
} from "../../../work/plans/plan-file.js";
import { ensureSpecBranch } from "../../../work/plans/spec-branch.js";

/** What a plan route needs to run a verb on the floor; a test hands in doubles for what production reads from the environment and the repo's GitHub App. */
export interface PlanVerbSeams {
  /** The live plan, which the floor's run downloads as plan.md; the plans registration supplies it. */
  livePlan?: PlanFilePorts["livePlan"];
  /** The floor the verbs run on; the deployment's own when absent. */
  floorDeps?: FloorPlanDeps;
}

/** The verbs of a plan's planning line. Every planning line runs on the external floor (ADR-049), so a deployment with none answers 503. */
export async function planVerbsFor(
  plan: PlanSubject,
  seams: PlanVerbSeams = {},
): Promise<PlanVerbs> {
  const { livePlan } = seams;
  const floor: PlanFloor | null = seams.floorDeps?.floor ?? floorIfConfigured();

  enforceTrue(
    floor,
    apiError(503),
    "plans need the external floor, and this deployment has none",
  );
  enforceTrue(
    livePlan,
    Error,
    "the plan verbs on the floor need the live plan",
  );
  const deps = seams.floorDeps ?? (await deploymentFloorDeps(plan.repo, floor));

  return floorPlanVerbs(deps, (planId) => planMarkdown(planId, { livePlan }));
}

async function deploymentFloorDeps(
  repo: string,
  floor: PlanFloor,
): Promise<FloorPlanDeps> {
  const { repo: files, pulls } = await projectFor(repo);

  return {
    floor,
    specBranch: (plan) => ensureSpecBranch(files, plan),
    baseBranch: () => files.defaultBranch(),
    specPrState: async (_repo, prNumber) =>
      (await pulls.get(prNumber))?.state ?? null,
    pulls,
  };
}
