/**
 * GET /healthz — liveness + readiness.
 *
 * Answers 200 as soon as the process is serving. Deliberately does NOT probe
 * the Kubernetes API: an apiserver blip would take the agent out of rotation
 * exactly when a caller most needs to hear a real error from it, and every
 * route already reports its own failure honestly.
 */

import type { ServerRoute } from "@hapi/hapi";

const startTime = Date.now();

export function healthRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/healthz",
    options: { auth: false },
    handler: (_request, h) =>
      h
        .response({
          status: "ok",
          uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
        })
        .code(200),
  };
}
