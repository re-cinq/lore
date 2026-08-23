/**
 * GET /healthz — liveness + readiness. 200 when Postgres answers, 503 when it
 * does not: every station here works by reading and writing the database, so a
 * pool that cannot answer means none of them can run.
 *
 * Deliberately thin: this process runs stations on demand and keeps no
 * counters of its own, so there is nothing else honest to report.
 */

import type { ServerRoute } from "@hapi/hapi";
import { isDbAvailable } from "../../kernel/db.js";

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
