import type { Pool } from "pg";
import { floorPlanVerbs } from "../../../work/plans/floor-plan-verbs.js";
import { floorIfConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { AssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs.js";
import { PgAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-pg.js";
import { projectFor } from "../../../outbound/project-boot.js";
import {
  type FloorPlanDeps,
  type PlanFloor,
} from "../../../work/plans/floor-plan-line.js";
import {
  planEngineOf,
  type PlanSubject,
  type PlanVerbs,
} from "../../../work/plans/plan-engine.js";
import {
  planMarkdown,
  type PlanFilePorts,
} from "../../../work/plans/plan-file.js";
import { postgresPlanVerbs } from "../../../work/plans/postgres-plan-verbs.js";
import { ensureSpecBranch } from "../../../work/plans/spec-branch.js";
import {
  planValidateDepsFor,
  projectionOf,
  specReworkDepsFor,
  specWorkDepsFor,
  type PlanValidateRouteDeps,
  type SpecReworkRouteDeps,
} from "./plan-line-deps.js";

/** What a plan route needs beside its pool to pick an engine and run a verb on it; a test hands in doubles for what production reads from the environment and the repo's GitHub App. */
export interface PlanVerbSeams {
  /** The live plan, which the floor's run downloads as plan.md; the plans registration supplies it. */
  livePlan?: PlanFilePorts["livePlan"];
  /** The rework's deps per repo. */
  specReworkDeps?: (repo: string, pool: Pool) => Promise<SpecReworkRouteDeps>;
  /** The validator's deps per repo. */
  planValidateDeps?: (
    repo: string,
    pool: Pool,
  ) => Promise<PlanValidateRouteDeps>;
  /** The floor the verbs run on when the plan is there; the deployment's own when absent. */
  floorDeps?: FloorPlanDeps;
}

/** The verbs of the engine that holds this plan's planning line: the external floor for a new plan or one already running there, Postgres for one still running on the old Floor. */
export async function planVerbsFor(
  pool: Pool,
  plan: PlanSubject,
  seams: PlanVerbSeams = {},
): Promise<PlanVerbs> {
  const floor: PlanFloor | null = seams.floorDeps?.floor ?? floorIfConfigured();
  const runs = new AssemblyRuns(plan.repo, new PgAssemblyRuns(pool));

  if ((await planEngineOf({ floor, runs }, plan)) === "floor") {
    return floorVerbsFor(plan.repo, floor, seams);
  }

  return postgresPlanVerbs({
    specWork: specWorkDepsFor(plan.repo, pool),
    projection: (planId) => projectionOf(() => pool, planId),
    rework: () => (seams.specReworkDeps ?? specReworkDepsFor)(plan.repo, pool),
    validate: () =>
      (seams.planValidateDeps ?? planValidateDepsFor)(plan.repo, pool),
  });
}

async function floorVerbsFor(
  repo: string,
  floor: PlanFloor | null,
  seams: PlanVerbSeams,
): Promise<PlanVerbs> {
  const { livePlan } = seams;

  enforceTrue(
    floor,
    Error,
    "a plan was sent to the floor on a deployment that has none",
  );
  enforceTrue(
    livePlan,
    Error,
    "the plan verbs on the floor need the live plan",
  );
  const deps = seams.floorDeps ?? (await deploymentFloorDeps(repo, floor));

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
    pulls,
  };
}
