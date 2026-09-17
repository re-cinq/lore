// `/api/cluster/agents` — the Agent CR surface, as DOMAIN operations (never raw get/replace, no resourceVersion crosses the wire).

import type { Lifecycle, ServerRoute } from "@hapi/hapi";
import { PUBLIC_GET } from "@re-cinq/lore-shared/http/route-options.js";
import { enforceIntegerInterval } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { guard, type ClusterRoutesDeps } from "./cluster-route-deps.js";
import { NO_HAPI_AUTH } from "@re-cinq/lore-shared/http/route-options.js";

/** Page ceiling — a caller asking for more is refused rather than quietly served a smaller page (a silent clamp reads as "read everything"). */
const MAX_PAGE = 100;

/** The four Agent-CR routes, in the order the Floor's cluster client calls them. */
export function agentRoutes(opts: ClusterRoutesDeps): ServerRoute[] {
  return [
    agentByNameRoute(opts),
    listAgentsRoute(opts),
    deleteAgentRoute(opts),
    podInfoRoute(opts),
  ];
}

/** `GET /api/cluster/agents/{name}` — reads one Agent CR. Called by the Floor's node-event handler and reaper to settle a visit. Answers 200 with `found:false` rather than 404: "no such CR" is an ordinary answer, and a 404 would be indistinguishable from the route being absent. */
function agentByNameRoute(opts: ClusterRoutesDeps): ServerRoute {
  return {
    ...PUBLIC_GET,
    path: "/api/cluster/agents/{name}",
    handler: async (request, h) => {
      guard(opts, request.headers);
      const { agents } = opts.deps();
      const cr = await agents.get(request.params.name);

      return h.response({ found: cr !== null, cr }).code(200);
    },
  };
}

/** `GET /api/cluster/agents` — one bounded page of Agent CRs. Called by the Floor's reconcile cron, the dropped-event safety net. */
function listAgentsRoute(opts: ClusterRoutesDeps): ServerRoute {
  return {
    ...PUBLIC_GET,
    path: "/api/cluster/agents",
    handler: listAgentsHandler(opts),
  };
}

// The ceiling is enforced rather than clamped: a larger page is what blew the heap on 2026-07-24, and silently narrowing it would hide the mistake.
function listAgentsHandler(opts: ClusterRoutesDeps): Lifecycle.Method {
  return async (request, h) => {
    guard(opts, request.headers);
    const q = request.query as Record<string, string | undefined>;
    const limit = Number(q.limit ?? MAX_PAGE);

    enforceIntegerInterval(limit, { min: 1, max: MAX_PAGE }, apiError(400));

    const { agents } = opts.deps();
    const page = await agents.list({
      labelSelector: q.labelSelector,
      limit,
      continue: q.continue,
    });

    return h.response(page).code(200);
  };
}

/** `DELETE /api/cluster/agents/{name}` — removes a terminal Agent CR. Called by this agent's own prune loop and by the Floor when a task settles. */
function deleteAgentRoute(opts: ClusterRoutesDeps): ServerRoute {
  return {
    method: "DELETE",
    path: "/api/cluster/agents/{name}",
    options: NO_HAPI_AUTH,
    handler: async (request, h) => {
      guard(opts, request.headers);
      const { agents } = opts.deps();

      await agents.remove(request.params.name);

      return h.response().code(204);
    },
  };
}

/** `GET /api/cluster/agents/{name}/pod-info` — the run pod behind one Agent CR. Called by the Floor's log reader to find the pod whose logs it wants. */
function podInfoRoute(opts: ClusterRoutesDeps): ServerRoute {
  return {
    method: "GET",
    path: "/api/cluster/agents/{name}/pod-info",
    options: NO_HAPI_AUTH,
    handler: async (request, h) => {
      guard(opts, request.headers);
      const { pods } = opts.deps();
      const pod = await pods.agentInfo(request.params.name);

      return h
        .response({
          found: pod !== null,
          phase: pod?.phase ?? null,
          jobName: pod?.jobName ?? null,
        })
        .code(200);
    },
  };
}
