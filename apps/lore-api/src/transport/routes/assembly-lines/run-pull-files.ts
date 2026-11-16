// GET /api/assembly-runs/{id}/pull-files — the changed files of the run's pull request. The run page's diff drawer names a run, never a repo and pull request of its own choosing (specs/assembly-line-run-viz FR8.4).

import type { Pool } from "pg";
import type { ResponseObject, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { AssemblyRunsPort } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { toRunRow } from "../../../work/assembly-runs/run-row.js";
import { runsReadingFloor } from "../../../work/floor/floor-backed-runs.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { pullFilesOf, PullFilesSchema } from "../repos/pull-files.js";
import { withPool } from "../with-pool.js";
import {
  enrichmentsFor,
  type EnrichmentReads,
} from "./floor-run-enrichment.js";

export interface RunPullFilesSeams {
  runsOf: (pool: Pool) => AssemblyRunsPort;
  /** No cost is read: the files need the run's pull request, not its price. */
  reads: Partial<EnrichmentReads>;
}

const PRODUCTION: RunPullFilesSeams = {
  runsOf: runsReadingFloor,
  reads: { costsByRun: async () => new Map() },
};

export function runPullFilesRoute(
  getPool: () => Pool | null,
  seams: RunPullFilesSeams = PRODUCTION,
): ServerRoute {
  return {
    method: "GET",
    path: "/api/assembly-runs/{id}/pull-files",
    options: zodResponse(bearerScope("read"), PullFilesSchema, {
      name: "AssemblyRunPullFiles",
      description:
        "Every changed file on the run's pull request with its unified patch. 404 for a run with no pull request",
      errors: [404],
    }),
    handler: withPool(getPool, (pool, request, h) =>
      servePullFiles(seams, { pool, runId: request.params.id }, h),
    ),
  };
}

async function servePullFiles(
  seams: RunPullFilesSeams,
  { pool, runId }: { pool: Pool; runId: string },
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const run = await seams.runsOf(pool).getById(runId);

  enforceTrue(run, apiError(404), "assembly run not found");
  const enrichment = (await enrichmentsFor(pool, [run], seams.reads)).get(
    run.id,
  );
  const row = toRunRow(run, enrichment);
  const number = row.task_pr_number ?? row.args_pr_number;

  enforceTrue(number, apiError(404), "this run has no pull request");

  return pullFilesOf(run.repo, number, h);
}
