/**
 * GET /healthz — liveness + readiness. 200 when Postgres answers, 503 when it
 * does not: a router that cannot write is not ready to be sent a webhook, and
 * GitHub redelivers a 5xx while a 202 it never earned would be lost.
 *
 * Deliberately thinner than the Floor's, which also reports task and job
 * counters. This process runs no tasks and no jobs; reporting on them would be
 * reporting on someone else's health.
 */

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
