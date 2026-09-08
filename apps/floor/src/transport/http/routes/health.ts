/** GET /healthz — liveness + readiness probe; Helm probes key on the status code only, the body is informational. */

import type { ServerRoute } from "@hapi/hapi";
import type { ProcessedCounts } from "@re-cinq/lore-shared/project/usage/usage-port.js";
import { isDbAvailable } from "../../../outbound/db.js";
import { usage } from "../../../outbound/queues.js";

const startTime = Date.now();

/** Status-returning DB probe: only the query is wrapped; null means it failed. */
async function probeProcessedCounts(): Promise<ProcessedCounts | null> {
  try {
    return await usage().processedCounts();
  } catch {
    return null;
  }
}

/** The informational body of a healthy probe; `current` is always null since the Floor no longer tracks an in-flight task here. */
function healthyBody(counts: ProcessedCounts, jobs: unknown) {
  return {
    status: "ok",
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    tasks: {
      processed_today: counts.today,
      processed_total: counts.total,
      current: null,
    },
    jobs,
    database: { connected: true },
  };
}

export function healthRoute(getJobStatus: () => unknown): ServerRoute {
  return {
    method: "GET",
    path: "/healthz",
    options: { auth: false },
    handler: async (_request, h) => {
      const counts = (await isDbAvailable())
        ? await probeProcessedCounts()
        : null;

      if (!counts) {
        return h
          .response({ status: "error", reason: "database connection failed" })
          .code(503);
      }

      return h.response(healthyBody(counts, getJobStatus())).code(200);
    },
  };
}
