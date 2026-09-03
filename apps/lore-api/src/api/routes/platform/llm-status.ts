import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { z } from "zod";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";

// Is the factory's model access down right now (#1455)? Derived on READ from station_runs, not mirrored from the Floor's in-memory gate — lore-api can't see another pod's memory.

/** Failure classes meaning the ACCOUNT is down, not one run — mirrors the Floor's dispatch-gate judgement. */
const ACCOUNT_WIDE = ["anthropic-credit"];

/** How far back a failure still counts as "right now" (long enough to survive a quiet stretch, short enough to clear fast). */
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

// Pure: only an account-wide failure class (e.g. anthropic-credit) degrades the platform, not e.g. 40 pods evicted for storage.
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

// `DISTINCT ON` picks the oldest row per class so detail+date come from the SAME failure — two independent MINs would mismatch them (lexicographic min(text) picks an unrelated row).
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

      enforceTrue(pool, apiError(503), "database unavailable");

      try {
        const { rows } = await pool.query(RECENT_FAILURES_SQL, [
          WINDOW_MINUTES,
        ]);

        return h.response(decideLlmStatus(rows as RecentFailureGroup[]));
      } catch (err) {
        // Pre-0042 DB (no failure columns) answers HEALTHY, not 500 — this is polled by a BANNER, don't let the outage-reporter report itself.
        if ((err as { code?: string }).code === UNDEFINED_COLUMN) {
          return h.response(HEALTHY);
        }

        throw err;
      }
    },
  };
}
