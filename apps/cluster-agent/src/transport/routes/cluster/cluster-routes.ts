// The cluster's Kubernetes surface, as HTTP — one module per path segment under this folder, mirroring the route tree; list is ONE apiserver page per call since 180 CRs blew Node's heap on 2026-07-24.

import type { ServerRoute } from "@hapi/hapi";
import { agentRoutes } from "./agents.js";
import { jobPodsRoute } from "./jobs.js";
import { podRoutes } from "./pods.js";
import { deletePerTaskTokenRoute } from "./per-task-tokens.js";
import { restartRoute } from "./restart.js";
import type { ClusterRoutesDeps } from "./cluster-route-deps.js";

export type { ClusterDeps, ClusterRoutesDeps } from "./cluster-route-deps.js";

export function clusterRoutes(opts: ClusterRoutesDeps): ServerRoute[] {
  return [
    ...agentRoutes(opts),
    jobPodsRoute(opts),
    ...podRoutes(opts),
    deletePerTaskTokenRoute(opts),
    restartRoute(opts),
  ];
}
