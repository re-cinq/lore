// `/api/cluster/per-task-tokens/*` — the reclaim half of the per-task credential lifecycle.

import type { ServerRoute } from "@hapi/hapi";
import { guard, type ClusterRoutesDeps } from "./cluster-route-deps.js";

/** `DELETE /api/cluster/per-task-tokens/{taskId}` — drops a settled task's credential. Called by the Floor when a task settles; the MINT side is not a route, because every launch is an in-process claim. */
export function deletePerTaskTokenRoute(opts: ClusterRoutesDeps): ServerRoute {
  return {
    method: "DELETE",
    path: "/api/cluster/per-task-tokens/{taskId}",
    options: { auth: false },
    handler: async (request, h) => {
      guard(opts, request.headers);
      const { tokens } = opts.deps();

      await tokens.cleanup(request.params.taskId);

      return h.response().code(204);
    },
  };
}
