import type { Lifecycle, Server } from "@hapi/hapi";
import type { Pool } from "pg";
import { registerPlanningSync } from "@re-cinq/planning-sync/hapi";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { pgPlanStore } from "../outbound/plans/plan-store-pg.js";
import { collabAuthenticator } from "../work/plans/collab-tokens.js";
import { DB_UNAVAILABLE } from "../transport/routes/common-schemas.js";
import type { TokenScope } from "../transport/http/auth.js";

export const PLANS_PREFIX = "/api/plans";

/** Plans hosted in this process (@re-cinq/planning-sync): REST under /api/plans and the collaboration socket at /api/plans/collab, on lore-api's own listener. */
export function registerPlanning(server: Server, getPool: () => Pool | null): void {
  const pool = (): Pool => {
    const live = getPool();

    enforceTrue(live, apiError(503), DB_UNAVAILABLE);

    return live;
  };

  registerPlanningSync(server, {
    store: pgPlanStore(pool),
    authenticator: collabAuthenticator(pool),
  });
  server.ext("onPreHandler", planRouteGuard(server));
}

// The library's routes carry no hapi auth of their own, so every /api/plans call is held to lore's bearer tokens here: any valid token reads, a write needs the `write` scope. The socket is an upgrade, not a route, and answers to its collab token instead.
const planRouteGuard =
  (server: Server): Lifecycle.Method =>
  async (request, h) => {
  if (!request.path.startsWith(PLANS_PREFIX)) {
    return h.continue;
  }
  const { credentials } = await server.auth.test("bearer-scope", request);
  const scopes = credentials.scope as TokenScope[];

  enforceTrue(
    request.method === "get" || scopes.includes("write") || scopes.includes("admin"),
    apiError(403),
    "insufficient scope",
  );

  return h.continue;
};
