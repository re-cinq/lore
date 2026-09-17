/** Both pod listings answer the same `{ pods }` shape; only the pod set they name differs, so the route is built once and the caller supplies the set. */

import type { ServerRoute } from "@hapi/hapi";
import type { ClusterDeps } from "../../../domain/cluster-deps.js";
import { guard, type ClusterRoutesDeps } from "./cluster-route-deps.js";

export function podListRoute(
  opts: ClusterRoutesDeps,
  path: string,
  list: (
    pods: ClusterDeps["pods"],
    params: Record<string, string>,
  ) => Promise<unknown>,
): ServerRoute {
  return {
    method: "GET",
    path,
    options: { auth: false },
    handler: async (request, h) => {
      guard(opts, request.headers);
      const { pods } = opts.deps();

      return h.response({ pods: await list(pods, request.params) }).code(200);
    },
  };
}
