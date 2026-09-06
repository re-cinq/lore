/** GET /healthz: 200 if Postgres answers (ready for webhooks), 503 otherwise. */

import type { ServerRoute } from "@hapi/hapi";
import { isDbAvailable } from "@re-cinq/lore-shared/db/pg-pool.js";

const startTime = Date.now();

export function healthRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/healthz",
    options: { auth: false },
    handler: async (_request, h) => {
      if (!(await isDbAvailable())) {
        return h
          .response({ status: "error", reason: "database connection failed" })
          .code(503);
      }

      return h
        .response({
          status: "ok",
          uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
          database: { connected: true },
        })
        .code(200);
    },
  };
}
