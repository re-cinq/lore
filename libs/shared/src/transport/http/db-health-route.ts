// GET /healthz for a service whose readiness IS the database: a process that cannot reach Postgres is not ready even though it is serving. Kept apart from health-route.ts so a probe of another shape does not drag the pool in.

import type { ServerRoute } from "@hapi/hapi";
import { isDbAvailable } from "../../outbound/db/pg-pool.js";
import { healthRoute } from "./health-route.js";

export function dbHealthRoute(): ServerRoute {
  return healthRoute(async () =>
    (await isDbAvailable()) ? { database: { connected: true } } : null,
  );
}
