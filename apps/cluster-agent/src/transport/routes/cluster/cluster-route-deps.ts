/** What every `/api/cluster/*` route needs, and the guard they all open with — shared by the route modules under this folder, which mirror the HTTP tree they serve. */

import type { ClusterDeps } from "../../../domain/cluster-deps.js";
import { enforceBearer } from "@re-cinq/lore-shared/http/bearer.js";

export type { ClusterDeps };

export interface ClusterRoutesDeps {
  /** A thunk: the Kubernetes clients are built lazily, after boot. */
  deps: () => ClusterDeps;
  bearerToken?: string;
  /** Defaults to `process.exit(0)`. Injectable so a test can observe the call without killing the test process. */
  restart?: () => void;
}

/** Every route is bearer-guarded with this agent's own token; the check is the first line of each handler so an unauthenticated call never reaches the cluster. */
export function guard(
  opts: ClusterRoutesDeps,
  headers: Record<string, unknown>,
): void {
  enforceBearer(headers, opts.bearerToken);
}
