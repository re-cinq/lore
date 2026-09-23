import type { Lifecycle, Server } from "@hapi/hapi";
import type { Pool } from "pg";
import { registerPlanningSync } from "@re-cinq/planning-sync/hapi";
import type { PlanLifecycleHooks } from "@re-cinq/planning-sync";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { pgPlanStore } from "../outbound/plans/plan-store-pg.js";
import { livePlanOf } from "../outbound/plans/live-plan.js";
import { planFileRoutes } from "../transport/routes/plans/plan-file.js";
import { planLifecycleRoutes } from "../transport/routes/plans/plan-lifecycle.js";
import { collabAuthenticator } from "../work/plans/collab-tokens.js";
import { handOverApproved } from "../work/plans/planning-line.js";
import {
  projectionOf,
  specWorkDepsFor,
} from "../transport/routes/plans/plan-line-deps.js";
import { DB_UNAVAILABLE } from "../transport/routes/common-schemas.js";
import type { TokenScope } from "../transport/http/auth.js";

export const PLANS_PREFIX = "/api/plans";

/** Plans hosted in this process (@re-cinq/planning-sync): REST under /api/plans and the collaboration socket at /api/plans/collab, on lore-api's own listener. */
export function registerPlanning(
  server: Server,
  getPool: () => Pool | null,
): void {
  const pool = livePool(getPool);

  const sync = registerPlanningSync(server, {
    store: pgPlanStore(pool),
    authenticator: collabAuthenticator(pool),
    onApproved: (meta) => startSpecWork(pool, meta),
  });

  server.route(
    planFileRoutes({ livePlan: livePlanOf(sync), writer: sync.writer }),
  );
  server.route(planLifecycleRoutes({ service: sync.service, getPool }));
  server.ext("onPreHandler", planRouteGuard(server));
}

// The pool, answering 503 while the database is away.
function livePool(getPool: () => Pool | null): () => Pool {
  return () => {
    const live = getPool();

    enforceTrue(live, apiError(503), DB_UNAVAILABLE);

    return live;
  };
}

// Approval ends the plan and starts its spec work on the same planning line — or, with no line waiting, on a fresh one entered at the spec analysis.
async function startSpecWork(
  pool: () => Pool,
  meta: Parameters<NonNullable<PlanLifecycleHooks["onApproved"]>>[0],
): Promise<void> {
  await handOverApproved(
    specWorkDepsFor(meta.repo, pool()),
    meta,
    await projectionOf(pool, meta.id),
    meta.approval?.approvedBy ?? meta.createdBy,
  );
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
      request.method === "get" ||
        scopes.includes("write") ||
        scopes.includes("admin"),
      apiError(403),
      "insufficient scope",
    );

    return h.continue;
  };
