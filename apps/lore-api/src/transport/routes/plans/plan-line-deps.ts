import type { Pool } from "pg";
import type { PlanDocument } from "@re-cinq/planning-document";
import {
  humanStationIds,
  loadBuiltinAssemblyLines,
  resolveRunGraph,
} from "@re-cinq/lore-assembly-lines";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { pgPlanStore, type Db } from "../../../outbound/plans/plan-store-pg.js";
import { projectFor } from "../../../outbound/project-boot.js";
import { AssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs.js";
import { PgAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-pg.js";
import type { PlanningRunPort } from "@re-cinq/lore-shared/project/plans/plan-run.js";
import { createTask } from "@re-cinq/lore-server-core/features/pipeline/pipeline.js";
import type {
  ResumeDeps,
  SpecWorkDeps,
} from "../../../work/plans/planning-line.js";
import type { SpecReworkDeps } from "../../../work/plans/spec-rework.js";
import type { PlanValidateDeps } from "../../../work/plans/plan-validate.js";
import { eventReporterFor } from "../event-reporter.js";

/** What resumes a repo's planning line: its assembly runs, and the reporter that raises the resume event. */
export function resumeDepsFor(repo: string, pool: Pool): ResumeDeps {
  return {
    runs: new AssemblyRuns(repo, new PgAssemblyRuns(pool)),
    reporter: eventReporterFor(pool),
  };
}

/** The plan's current JSON projection; a plan with none yet is not found. */
export async function projectionOf(
  db: Db,
  planId: string,
): Promise<PlanDocument> {
  const stored = await pgPlanStore(db).loadProjection(planId);

  enforceTrue(stored, apiError(404), "plan not found");

  return stored.json;
}

/** Resume deps plus the task a fresh line starts from — one shape for the drafting route, the approval hook and the spec-work route. */
export function specWorkDepsFor(repo: string, pool: Pool): SpecWorkDeps {
  return {
    ...resumeDepsFor(repo, pool),
    createTask: async (task) => String((await createTask(task)).task_id),
  };
}

/** What the spec rework needs: the plan's line (read like every other lifecycle decision), the run to store the review on, the repo's PR reads, and the hand-run mechanism. */
export type SpecReworkRouteDeps = SpecReworkDeps & { line: PlanningRunPort };

export async function specReworkDepsFor(
  repo: string,
  pool: Pool,
): Promise<SpecReworkRouteDeps> {
  const runs = new PgAssemblyRuns(pool);

  return {
    line: new AssemblyRuns(repo, runs),
    runs,
    pulls: (await projectFor(repo)).pulls,
    station: {
      runs,
      reporter: eventReporterFor(pool),
      graphOf: (line) => resolveRunGraph(line, loadBuiltinAssemblyLines),
      humanStationIds,
    },
  };
}

/** What plan validation needs: the plan's line, and the hand-run mechanism to launch the validate station. */
export type PlanValidateRouteDeps = PlanValidateDeps & {
  line: PlanningRunPort;
};

export async function planValidateDepsFor(
  repo: string,
  pool: Pool,
): Promise<PlanValidateRouteDeps> {
  const runs = new PgAssemblyRuns(pool);

  return {
    line: new AssemblyRuns(repo, runs),
    station: {
      runs,
      reporter: eventReporterFor(pool),
      graphOf: (line) => resolveRunGraph(line, loadBuiltinAssemblyLines),
      humanStationIds,
    },
  };
}
