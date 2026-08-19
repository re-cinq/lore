import type { ServerRoute } from "@hapi/hapi";
import Boom from "@hapi/boom";
import { z } from "zod";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { PgMemoryLifecycle } from "@re-cinq/lore-shared/project/memory/memory-lifecycle-pg.js";
import { importanceDecay } from "../../../features/maintenance/importance-decay.js";
import { anthropicCostSyncJob } from "../../../features/maintenance/cost/anthropic-cost-sync.js";
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

/** The registry, bound to a pool. A job is added here when it leaves the Floor. */
export function maintenanceJobs(getPool: () => Pool | null): MaintenanceJobs {
  const pool = (): Pool => {
    const p = getPool();

    enforceTrue(p !== null, Boom.serverUnavailable, "database unavailable");

    return p;
  };

  return {
    // Was the Floor's `memory_ttl` job — 14 lines around one DELETE, with its
    // own CronJob pod built from the coordinator's image.
    "memory-ttl": async () => {
      const count = await new PgMemoryLifecycle(pool()).expireMemories();

      return `Cleaned up ${count} expired memories`;
    },

    // Was the Floor's `importance_decay` job (#1350).
    "importance-decay": () => importanceDecay(new PgMemoryLifecycle(pool())),

    // Was the Floor's `anthropic_cost_sync` job (#1348). Reads the Anthropic
    // Admin API and upserts daily rows — an import, not coordination.
    "anthropic-cost-sync": () => anthropicCostSyncJob(new PgCost(pool())),
  };
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
        Boom.notFound,
        `unknown maintenance job: ${name}`,
      );

      try {
        return { job: name, summary: await job() };
      } catch (err) {
        // The courier's only channel is an HTTP status, and a job's error can
        // carry connection strings and hostnames. Log it where operators look;
        // answer the caller with a status and nothing else.
        console.error(`[maintenance] ${name} failed:`, err);

        throw Boom.internal(`maintenance job failed: ${name}`);
      }
    },
  };
}
