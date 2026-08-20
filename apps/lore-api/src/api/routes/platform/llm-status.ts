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

/**
 * One row per recent failure class: how many runs it touched, when it started,
 * and the detail of the run that started it.
 *
 * `min(failure_detail)` alongside `min(finished_at)` was two INDEPENDENT
 * aggregates — `min` over text is lexicographic, so the quoted message was the
 * alphabetically smallest in the group and belonged to no particular row, while
 * `since` came from a different one. The banner quotes a message and dates it;
 * both must come from the same failure. `DISTINCT ON` picks the oldest row per
 * class, and the count is joined onto it.
 */
const RECENT_FAILURES_SQL = `
  WITH recent AS (
    SELECT failure_class, failure_detail, finished_at, assembly_run_id
      FROM pipeline.station_runs
     WHERE failure_class IS NOT NULL
       AND finished_at > now() - ($1 || ' minutes')::interval
  ), oldest AS (
    SELECT DISTINCT ON (failure_class)
           failure_class, failure_detail, finished_at AS oldest
      FROM recent
     ORDER BY failure_class, finished_at
  )
  SELECT o.failure_class, o.failure_detail, o.oldest,
         count(DISTINCT r.assembly_run_id)::int AS runs
    FROM oldest o
    JOIN recent r ON r.failure_class = o.failure_class
   GROUP BY o.failure_class, o.failure_detail, o.oldest`;

/** Postgres "undefined column" — a database that predates migration 0042. */
const UNDEFINED_COLUMN = "42703";

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

      try {
        const { rows } = await pool.query(RECENT_FAILURES_SQL, [
          WINDOW_MINUTES,
        ]);

        return h.response(decideLlmStatus(rows as RecentFailureGroup[]));
      } catch (err) {
        // A database without the failure columns answers HEALTHY rather than
        // 500, the same way the run reads degrade to empty on a pre-0025 one.
        // The deploy hook makes migrate-then-serve the normal ordering, so this
        // is the abnormal path — a rolled-back migration, an image ahead of the
        // hook, a local dev database. This endpoint is polled by a BANNER, and
        // a 500 there is the outage-reporting machinery reporting itself.
        if ((err as { code?: string }).code === UNDEFINED_COLUMN) {
          return h.response(HEALTHY);
        }

        throw err;
      }
    },
  };
}
