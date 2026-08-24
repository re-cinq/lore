import type { ServerRoute } from "@hapi/hapi";
import { apiError } from "../../../server/api-error.js";
import { z } from "zod";
import {
  STATIONS,
  hostCanRun,
  isSweepModule,
  unsupportedPort,
  type StationHost,
  type StationPortName,
} from "@re-cinq/lore-station-registry";

/** What this process can serve: a pool, and no code host. */
const SERVED: readonly StationPortName[] = ["memoryLifecycle", "cost"];

import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { PgMemoryLifecycle } from "@re-cinq/lore-shared/project/memory/memory-lifecycle-pg.js";
import { PgCost } from "@re-cinq/lore-shared/project/cost/cost-pg.js";
import type { Pool } from "pg";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";

/**
 * POST /api/maintenance/{job} — run one scheduled data operation.
 *
 * The endpoint a courier CronJob posts to for work that has no steps (#1357).
 * These jobs used to live in `apps/floor` and run in a CronJob pod built from
 * the Floor's image — not because the Floor coordinates them, but because that
 * image was what the Kubernetes alarm launched. A single data operation needs
 * none of the Floor's three exclusive powers (ADR-024), so it runs here, next
 * to the database it writes.
 *
 * Deliberately NOT an assembly line: the node types are a closed set with
 * nothing for "do a data operation", and a one-node line would put a station
 * pod and a Floor walk between the alarm and one statement.
 */

/** A job's whole contract: run, and return the one-line summary that used to be
 *  `pipeline.job_runs.result_summary`. */
export type MaintenanceJob = () => Promise<string>;
export type MaintenanceJobs = Record<string, MaintenanceJob>;

const MaintenanceResponse = z.object({
  job: z.string(),
  summary: z.string(),
});

/**
 * The jobs this service answers for, DERIVED from the shared station registry.
 *
 * It used to be a hand-written map — the third of three registries that shared a
 * signature and could not check each other. The jobs themselves now live one
 * folder each in @re-cinq/lore-station-registry with the rest of the stations;
 * this only binds them to the pool THIS process holds, because a station is
 * given its data rather than resolving it.
 *
 * Deployment is unchanged: the courier CronJob still posts
 * /api/maintenance/<job> here, on the same schedules.
 */
export function maintenanceJobs(getPool: () => Pool | null): MaintenanceJobs {
  const pool = (): Pool => {
    const p = getPool();

    enforceTrue(p !== null, apiError(503), "database unavailable");

    return p;
  };

  // Resolved lazily, per call: the pool may not exist when the route is built.
  //
  // This host serves the two data ports and says so about the rest. lore-api has
  // no GitHub App, so a repo sweep cannot run here — and only cron-triggered
  // stations are exposed below, so none ever asks.
  const host = (): StationHost => ({
    memoryLifecycle: () => new PgMemoryLifecycle(pool()),
    cost: () => new PgCost(pool()),
    awaitingApproval: unsupportedPort("awaitingApproval", "lore-api"),
    approvalLabel: unsupportedPort("approvalLabel", "lore-api"),
    repoFor: unsupportedPort("repoFor", "lore-api"),
  });

  return Object.fromEntries(
    Object.values(STATIONS)
      .filter(isSweepModule)
      .filter((mod) => mod.manifest.triggers.some((t) => t.kind === "cron"))
      // Only what this host can actually RUN. Without it lore-api advertised the
      // repo sweep it has no GitHub App for, so the failure was reachable from
      // outside rather than impossible.
      .filter((mod) => hostCanRun(mod.manifest, SERVED))
      .map((mod) => [
        mod.manifest.name,
        () => mod.run({ trigger: "cron", host: host() }),
      ]),
  );
}

export function maintenanceRoute(jobs: MaintenanceJobs): ServerRoute {
  return {
    method: "POST",
    path: "/api/maintenance/{job}",
    options: zodResponse(bearerScope("task"), MaintenanceResponse, {
      name: "MaintenanceResult",
      description: "Job completed",
    }),
    handler: async (request) => {
      const name = request.params.job;
      const job = jobs[name];

      enforceTrue(
        job !== undefined,
        apiError(404),
        `unknown maintenance job: ${name}`,
      );

      try {
        return { job: name, summary: await job() };
      } catch (err) {
        // The courier's only channel is an HTTP status, and a job's error can
        // carry connection strings and hostnames. Log it where operators look;
        // answer the caller with a status and nothing else.
        console.error(`[maintenance] ${name} failed:`, err);

        throw apiError(500)(`maintenance job failed: ${name}`);
      }
    },
  };
}
