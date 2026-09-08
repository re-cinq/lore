/** GET /healthz: 200 if Postgres answers (ready for webhooks), 503 otherwise. */

import type { Lifecycle, ServerRoute } from "@hapi/hapi";
import { isDbAvailable } from "@re-cinq/lore-shared/db/pg-pool.js";

const startTime = Date.now();

// Ready means Postgres answers: the router's whole job is to write events, so a process that cannot reach the database is not ready for webhooks even though it is running.
const healthHandler: Lifecycle.Method = async (_request, h) => {
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
};

export function healthRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/healthz",
    options: { auth: false },
    handler: healthHandler,
  };
}
