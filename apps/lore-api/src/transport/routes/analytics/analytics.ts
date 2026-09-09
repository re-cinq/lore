import { zodResponse } from "../../http/zod-response.js";
import { errorMessage } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
import {
  ANALYTICS_PERIODS,
  pipelineAnalytics,
} from "../../../work/analytics/analytics-queries.js";
import { withPool } from "../with-pool.js";

const AnalyticsQuery = z.object({
  period: z.enum(ANALYTICS_PERIODS).default("month"),
});

type AnalyticsQuery = z.infer<typeof AnalyticsQuery>;

/** Org-wide pipeline analytics for a period — a roll-up, not a row. */
const PipelineAnalyticsSchema = z.record(z.string(), z.unknown());

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
    handler: withPool(getPool, serveAnalytics),
  };
}

async function serveAnalytics(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const { period } = request.query as unknown as AnalyticsQuery;

  try {
    return h.response(await pipelineAnalytics(pool, period));
  } catch (err) {
    return h.response({ error: errorMessage(err) }).code(500);
  }
}
