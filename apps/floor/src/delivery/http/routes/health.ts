/**
 * GET /healthz — liveness + readiness probe. Returns 200 with task/job status
 * when the DB is reachable, 503 otherwise. The Helm probes key on the status
 * code only; the body is informational.
 */

import type { ServerRoute } from "@hapi/hapi";
import { isDbAvailable } from "../../../kernel/db.js";
import { usage } from "../../../kernel/queues.js";

const startTime = Date.now();

export function healthRoute(getJobStatus: () => unknown): ServerRoute {
  return {
    method: "GET",
    path: "/healthz",
    options: { auth: false },
    handler: async (_request, h) => {
      if (!(await isDbAvailable())) {
        return h.response({ status: "error", reason: "database connection failed" }).code(503);
      }

      try {
        const { today: processedToday, total: processedTotal } = await usage().processedCounts();
        return h
          .response({
            status: "ok",
            uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
            tasks: { processed_today: processedToday, processed_total: processedTotal, current: null },
            jobs: getJobStatus(),
            database: { connected: true },
          })
          .code(200);
      } catch {
        return h.response({ status: "error", reason: "database connection failed" }).code(503);
      }
    },
  };
}
