/** GET /healthz for every Lore service: the caller's probe decides ready, this decides the envelope Helm reads. */

import type { Lifecycle, ServerRoute } from "@hapi/hapi";

const startTime = Date.now();

// Every service that has one answers to the same failure, so the reason is the envelope's, not a caller's argument.
const NOT_READY_REASON = "database connection failed";

/** Ready returns the detail that rides alongside `status` in the 200 body; not ready returns null. */
export type ReadinessProbe = () => Promise<Record<string, unknown> | null>;

function healthHandler(probe: ReadinessProbe): Lifecycle.Method {
  return async (_request, h) => {
    const detail = await probe();

    if (!detail) {
      return h
        .response({ status: "error", reason: NOT_READY_REASON })
        .code(503);
    }

    return h
      .response({
        status: "ok",
        uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
        ...detail,
      })
      .code(200);
  };
}

export function healthRoute(probe: ReadinessProbe): ServerRoute {
  return {
    method: "GET",
    path: "/healthz",
    options: { auth: false },
    handler: healthHandler(probe),
  };
}
