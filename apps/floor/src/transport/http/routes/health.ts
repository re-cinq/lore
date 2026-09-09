/** GET /healthz — liveness + readiness probe; Helm probes key on the status code only, the body is informational. */

import type { ServerRoute } from "@hapi/hapi";
import { healthRoute as sharedHealthRoute } from "@re-cinq/lore-shared/http/health-route.js";
import type { ProcessedCounts } from "@re-cinq/lore-shared/project/usage/usage-port.js";
import { isDbAvailable } from "../../../outbound/db.js";
import { usage } from "../../../outbound/queues.js";

export function healthRoute(getJobStatus: () => unknown): ServerRoute {
  return sharedHealthRoute(async () => {
    const counts = await probeProcessedCounts();

    return counts
      ? {
          tasks: {
            processed_today: counts.today,
            processed_total: counts.total,
            current: null,
          },
          jobs: getJobStatus(),
          database: { connected: true },
        }
      : null;
  });
}

/** Status-returning DB probe: only the query is wrapped; null means it failed. */
async function probeProcessedCounts(): Promise<ProcessedCounts | null> {
  if (!(await isDbAvailable())) {
    return null;
  }

  try {
    return await usage().processedCounts();
  } catch {
    return null;
  }
}
