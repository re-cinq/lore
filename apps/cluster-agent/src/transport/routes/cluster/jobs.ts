// `/api/cluster/jobs/*` — what a Kubernetes Job launched, from the Floor's side of the network.

import type { ServerRoute } from "@hapi/hapi";
import { podListRoute } from "./pod-listing.js";
import type { ClusterRoutesDeps } from "./cluster-route-deps.js";

/** `GET /api/cluster/jobs/{jobName}/pods` — the pods one Job created. Called by the Floor's log reader, which knows a Job name before it knows a pod name. */
export function jobPodsRoute(opts: ClusterRoutesDeps): ServerRoute {
  return podListRoute(
    opts,
    "/api/cluster/jobs/{jobName}/pods",
    (pods, params) => pods.podsForJob(params.jobName),
  );
}
