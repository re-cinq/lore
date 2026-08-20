import { zodResponse } from "../../../server/plugins/zod-response.js";
import { z } from "zod";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";

// Is the factory's model access down right now, and since when (#1455)?
//
// Derived on READ from the failure classes station runs recorded, rather than
// mirrored from the Floor's in-memory dispatch gate: lore-api cannot see another
// pod's memory, and a second copy of that state would be wrong exactly when it
// mattered. The station_runs rows are the shared substrate both sides already
// agree on.

/** Failure classes that mean the ACCOUNT is down rather than one run — the same
 *  judgement the Floor's dispatch gate makes, kept in step with it deliberately. */
const ACCOUNT_WIDE = ["anthropic-credit"];

/** How far back a failure still counts as "right now". Long enough to survive a
 *  quiet stretch between runs, short enough that a topped-up account stops
 *  showing a banner within one window. */
const WINDOW_MINUTES = 30;

const LlmStatusSchema = z.object({
  degraded: z.boolean(),
  failure_class: z.string().nullable(),
  detail: z.string().nullable(),
  since: z.date().nullable(),
  affected_runs: z.number(),
});

export type LlmStatus = z.infer<typeof LlmStatusSchema>;

/** One class of recent failure, as the query groups them. */
export interface RecentFailureGroup {
  failure_class: string;
  failure_detail: string | null;
  oldest: Date;
  runs: number;
}

const HEALTHY: LlmStatus = {
  degraded: false,
  failure_class: null,
  detail: null,
  since: null,
  affected_runs: 0,
};

/**
 * Pure: what recent failures say about the platform.
 *
 * Only an account-wide class degrades the platform. Forty pods evicted for
 * ephemeral storage is a bad afternoon for forty runs; one `anthropic-credit`
 * means nothing with a model call in it can succeed, which is the thing worth
 * putting in front of somebody before they retry by hand.
 */
export function decideLlmStatus(groups: RecentFailureGroup[]): LlmStatus {
  const outage = groups.find((g) => ACCOUNT_WIDE.includes(g.failure_class));

  if (!outage) {
    return HEALTHY;
  }

  return {
    degraded: true,
    failure_class: outage.failure_class,
    detail: outage.failure_detail,
    since: outage.oldest,
    affected_runs: outage.runs,
  };
}

const RECENT_FAILURES_SQL = `
  SELECT failure_class,
         min(failure_detail) AS failure_detail,
         min(finished_at)    AS oldest,
         count(DISTINCT assembly_run_id)::int AS runs
    FROM pipeline.station_runs
   WHERE failure_class IS NOT NULL
     AND finished_at > now() - ($1 || ' minutes')::interval
   GROUP BY failure_class`;

export function llmStatusRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/platform/llm-status",
    options: zodResponse(bearerScope("read"), LlmStatusSchema, {
      name: "PlatformLlmStatus",
      description:
        "Whether an account-wide LLM outage is degrading the factory",
    }),
    handler: async (request, h) => {
      const pool = getPool();

      if (!pool) {
        return h.response({ error: "database unavailable" }).code(503);
      }

      const { rows } = await pool.query(RECENT_FAILURES_SQL, [WINDOW_MINUTES]);

      return h.response(decideLlmStatus(rows as RecentFailureGroup[]));
    },
  };
}
