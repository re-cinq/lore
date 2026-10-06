import type { Lifecycle, Server } from "@hapi/hapi";
import type { Pool } from "pg";
import {
  registerPlanningSync,
  type PlanningSync,
} from "@re-cinq/planning-sync/hapi";
import type { PlanLifecycleHooks } from "@re-cinq/planning-sync";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { pgPlanStore } from "../outbound/plans/plan-store-pg.js";
import { livePlanOf } from "../outbound/plans/live-plan.js";
import { pgRefineAsks } from "../work/plans/refine-asks-pg.js";
import { planFileRoutes } from "../transport/routes/plans/plan-file.js";
import type { PlanFilePorts } from "../work/plans/plan-file.js";
import { planLifecycleRoutes } from "../transport/routes/plans/plan-lifecycle.js";
import { collabAuthenticator } from "../work/plans/collab-tokens.js";
import {
  planVerbsFor,
  type PlanVerbSeams,
} from "../transport/routes/plans/plan-verbs-for.js";
import { DB_UNAVAILABLE } from "../transport/routes/common-schemas.js";
import type { TokenScope } from "../transport/http/auth.js";

export const PLANS_PREFIX = "/api/plans";

/** What the plans registration hands the rest of the server: the collaboration server the live socket tunnels to (ADR-048), and what the plan routes need to run their verbs. */
export interface RegisteredPlanning {
  collab: PlanningSync["collab"];
  plans: PlanVerbSeams;
}

/** Plans hosted in this process (@re-cinq/planning-sync): REST under /api/plans and the collaboration socket at /api/plans/collab, on lore-api's own listener. */
export function registerPlanning(
  server: Server,
  getPool: () => Pool | null,
  floorDeps?: PlanVerbSeams["floorDeps"],
): RegisteredPlanning {
  const pool = livePool(getPool);
  const seams: PlanVerbSeams = { floorDeps };

  const sync = registerPlanningSync(server, {
    store: pgPlanStore(pool),
    authenticator: collabAuthenticator(pool),
    onApproved: (meta) => startSpecWork(meta, seams),
  });

  // onApproved reaches the library before the sync it reads the plan through exists, so the seams are filled once it does.
  seams.livePlan = livePlanOf(sync);
  server.route([
    ...planFileRoutes(filePorts(seams.livePlan, sync, pool)),
    ...planLifecycleRoutes({ service: sync.service, getPool, ...seams }),
  ]);
  server.ext("onPreHandler", planRouteGuard(server));

  return { collab: sync.collab, plans: seams };
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
  meta: Parameters<NonNullable<PlanLifecycleHooks["onApproved"]>>[0],
  seams: PlanVerbSeams,
): Promise<void> {
  const verbs = await planVerbsFor(meta, seams);

  await verbs.handOverApproved(
    meta,
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

function filePorts(
  livePlan: PlanFilePorts["livePlan"],
  sync: { writer: PlanFilePorts["writer"] },
  pool: () => Pool,
): PlanFilePorts {
  return { livePlan, writer: sync.writer, refineAsks: pgRefineAsks(pool) };
}
