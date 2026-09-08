// GET /healthz — 200 when Postgres answers, 503 otherwise (every station here needs the DB); deliberately thin, no counters of its own.

import type { Lifecycle, ServerRoute } from "@hapi/hapi";
import { isDbAvailable } from "@re-cinq/lore-shared/db/pg-pool.js";

const startTime = Date.now();

// Every station here needs the database, so a process that cannot reach it is not ready even though it is serving. Deliberately thin — no counters of its own.
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
