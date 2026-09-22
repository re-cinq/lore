// `/api/cluster/restart` — the remote bounce, for a cluster-agent whose Kubernetes clients need re-establishing.

import type { ServerRoute } from "@hapi/hapi";
import { guard, type ClusterRoutesDeps } from "./cluster-route-deps.js";
import { NO_HAPI_AUTH } from "@re-cinq/lore-shared/http/route-options.js";

/** `POST /api/cluster/restart` — exits the process so Kubernetes restarts it. Called by lore-api's cluster-agents admin page; the exit is deferred so the response reaches the caller first. */
export function restartRoute(opts: ClusterRoutesDeps): ServerRoute {
  return {
    method: "POST",
    path: "/api/cluster/restart",
    options: NO_HAPI_AUTH,
    handler: (request, h) => {
      guard(opts, request.headers);
      const restart = opts.restart ?? (() => process.exit(0));

      setImmediate(restart);

      return h.response().code(204);
    },
  };
}
