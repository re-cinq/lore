// `/api/cluster/pods/*` — the run pods themselves: what is running, and what one of them printed.

import type {
  Lifecycle,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import type { ClusterDeps } from "../../../domain/cluster-deps.js";
import { podListRoute } from "./pod-listing.js";
import { guard, type ClusterRoutesDeps } from "./cluster-route-deps.js";
import { isLogUnavailable } from "../../../lib/k8s-errors.js";
import { NO_HAPI_AUTH } from "@re-cinq/lore-shared/http/route-options.js";

/** Log tail ceiling, clamped HERE — the Floor's clamp no longer protects this process's heap. */
const MAX_TAIL = 10_000;

export function podRoutes(opts: ClusterRoutesDeps): ServerRoute[] {
  return [runningPodsRoute(opts), podLogRoute(opts)];
}

/** `GET /api/cluster/pods` — every non-terminal run pod with its resource requests. Called by lore-api's spend page for the live half of the compute-cost estimate. */
function runningPodsRoute(opts: ClusterRoutesDeps): ServerRoute {
  return podListRoute(opts, "/api/cluster/pods", (pods) => pods.listRunning());
}

/** `GET /api/cluster/pods/{podName}/log` — one pod's log tail. Called by the Floor's agent-log reader and, through it, the run page's live log view. */
function podLogRoute(opts: ClusterRoutesDeps): ServerRoute {
  return {
    method: "GET",
    path: "/api/cluster/pods/{podName}/log",
    options: NO_HAPI_AUTH,
    handler: podLogHandler(opts),
  };
}

// Unlike the agents page limit, a bad `tail` is CLAMPED rather than refused: the reader wants logs, and the exact line count is not what they came for.
function podLogHandler(opts: ClusterRoutesDeps): Lifecycle.Method {
  return async (request, h) => {
    guard(opts, request.headers);
    const asked = Number(
      (request.query as Record<string, string | undefined>).tail ?? MAX_TAIL,
    );
    const tail = Number.isInteger(asked) && asked > 0 ? asked : MAX_TAIL;
    const { pods } = opts.deps();

    return respondWithPodLog(pods, request.params.podName, tail, h);
  };
}

// A log the kubelet will not serve is an ordinary absence, and the Floor's reader falls back to the durable archive on a 404 alone. A genuine fault (403 RBAC, 5xx) must NOT become a 404: the archive cannot substitute for a permission the cluster-agent is missing, and hiding it is how the Floor's absent delete verb went unnoticed for 40 days.
async function respondWithPodLog(
  pods: ClusterDeps["pods"],
  podName: string,
  tail: number,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  try {
    const logs = await pods.podLog(podName, Math.min(tail, MAX_TAIL));

    return h.response({ logs }).code(200);
  } catch (err) {
    if (isLogUnavailable(err)) {
      return h.response({ error: "pod log unavailable" }).code(404);
    }

    throw err;
  }
}
