import { zodResponse } from "../../../server/plugins/zod-response.js";
import { errorMessage } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";
import {
  ANALYTICS_PERIODS,
  pipelineAnalytics,
} from "../../../features/analytics/analytics-queries.js";

const AnalyticsQuery = z.object({
  period: z.enum(ANALYTICS_PERIODS).default("month"),
});

type AnalyticsQuery = z.infer<typeof AnalyticsQuery>;

/** Org-wide pipeline analytics for a period — a roll-up, not a row. */
const PipelineAnalyticsSchema = z.record(z.unknown());

export function analyticsRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/analytics",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { query: zodValidate(AnalyticsQuery) },
      },
      PipelineAnalyticsSchema,
      { name: "PipelineAnalytics", description: "Org-wide pipeline analytics" },
    ),
    handler: async (request, h) => {
      const pool = getPool();

      if (!pool) {
        return h.response({ error: DB_UNAVAILABLE }).code(503);
      }

      const { period } = request.query as unknown as AnalyticsQuery;

      try {
        return h.response(await pipelineAnalytics(pool, period));
      } catch (err) {
        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
