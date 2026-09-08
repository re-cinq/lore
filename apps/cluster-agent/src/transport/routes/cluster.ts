// The cluster's Kubernetes surface, as HTTP — every route is a DOMAIN operation (never raw get/replace, no resourceVersion crosses the wire); list is ONE apiserver page per call since 180 CRs blew Node's heap on 2026-07-24.

import type { Lifecycle, ServerRoute } from "@hapi/hapi";
import type { ClusterDeps } from "../../domain/cluster-deps.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceBearer } from "@re-cinq/lore-shared/http/bearer.js";

/** Page ceiling — a caller asking for more is refused rather than quietly served a smaller page (a silent clamp reads as "read everything"). */
const MAX_PAGE = 100;
/** Log tail ceiling, clamped HERE — the Floor's clamp no longer protects this process's heap. */
const MAX_TAIL = 10_000;

export type { ClusterDeps };

export interface ClusterRoutesDeps {
  /** A thunk: the Kubernetes clients are built lazily, after boot. */
  deps: () => ClusterDeps;
  bearerToken?: string;
  /** Defaults to `process.exit(0)`. Injectable so a test can observe the call without killing the test process. */
  restart?: () => void;
}

/** Every route is bearer-guarded with this agent's own token; the check is the first line of each handler so an unauthenticated call never reaches the cluster. */
function guard(
  opts: ClusterRoutesDeps,
  headers: Record<string, unknown>,
): void {
  enforceBearer(headers, opts.bearerToken);
}

export function clusterRoutes(opts: ClusterRoutesDeps): ServerRoute[] {
  return [
    agentByNameRoute(opts),
    listAgentsRoute(opts),
    deleteAgentRoute(opts),
    podInfoRoute(opts),
    podsRoute(opts, "/api/cluster/jobs/{jobName}/pods", (pods, params) =>
      pods.podsForJob(params.jobName),
    ),
    podsRoute(opts, "/api/cluster/pods", (pods) => pods.listRunning()),
    podLogRoute(opts),
    deletePerTaskTokenRoute(opts),
    restartRoute(opts),
  ];
}

function agentByNameRoute(opts: ClusterRoutesDeps): ServerRoute {
  return {
    // 200 with `found:false` rather than 404 — "no such CR" is an ordinary answer, and a 404 would be indistinguishable from the route being absent.
    method: "GET",
    path: "/api/cluster/agents/{name}",
    options: { auth: false },
    handler: async (request, h) => {
      guard(opts, request.headers);
      const { agents } = opts.deps();
      const cr = await agents.get(request.params.name);

      return h.response({ found: cr !== null, cr }).code(200);
    },
  };
}

// Lists Agent CRs, one bounded page at a time. The ceiling is enforced rather than clamped: a caller asking for more than `MAX_PAGE` is told so, because a larger page is what blew the heap on 2026-07-24 and silently narrowing it would hide the mistake.
function listAgentsHandler(opts: ClusterRoutesDeps): Lifecycle.Method {
  return async (request, h) => {
    guard(opts, request.headers);
    const q = request.query as Record<string, string | undefined>;
    const limit = Number(q.limit ?? MAX_PAGE);

    enforceTrue(
      Number.isInteger(limit) && limit > 0 && limit <= MAX_PAGE,
      apiError(400),
      `limit must be an integer in 1..${MAX_PAGE} — a larger page is what blew the heap on 2026-07-24`,
    );
    const { agents } = opts.deps();
    const page = await agents.list({
      labelSelector: q.labelSelector,
      limit,
      continue: q.continue,
    });

    return h.response(page).code(200);
  };
}

function listAgentsRoute(opts: ClusterRoutesDeps): ServerRoute {
  return {
    method: "GET",
    path: "/api/cluster/agents",
    options: { auth: false },
    handler: listAgentsHandler(opts),
  };
}

function deleteAgentRoute(opts: ClusterRoutesDeps): ServerRoute {
  return {
    method: "DELETE",
    path: "/api/cluster/agents/{name}",
    options: { auth: false },
    handler: async (request, h) => {
      guard(opts, request.headers);
      const { agents } = opts.deps();

      await agents.remove(request.params.name);

      return h.response().code(204);
    },
  };
}

function podInfoRoute(opts: ClusterRoutesDeps): ServerRoute {
  return {
    method: "GET",
    path: "/api/cluster/agents/{name}/pod-info",
    options: { auth: false },
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

// Both pod listings answer the same `{ pods }` shape; only the pod set they name differs.
function podsRoute(
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

// One pod's log tail. Unlike the page limit above, a bad `tail` is CLAMPED rather than refused — the reader wants logs, and the exact line count is not what they came for.
function podLogHandler(opts: ClusterRoutesDeps): Lifecycle.Method {
  return async (request, h) => {
    guard(opts, request.headers);
    const asked = Number(
      (request.query as Record<string, string | undefined>).tail ?? MAX_TAIL,
    );
    const tail = Number.isInteger(asked) && asked > 0 ? asked : MAX_TAIL;
    const { pods } = opts.deps();
    const logs = await pods.podLog(
      request.params.podName,
      Math.min(tail, MAX_TAIL),
    );

    return h.response({ logs }).code(200);
  };
}

function podLogRoute(opts: ClusterRoutesDeps): ServerRoute {
  return {
    method: "GET",
    path: "/api/cluster/pods/{podName}/log",
    options: { auth: false },
    handler: podLogHandler(opts),
  };
}

function deletePerTaskTokenRoute(opts: ClusterRoutesDeps): ServerRoute {
  return {
    // The mint side is NOT a route — every launch is an in-process claim; what crosses the network is the reclaim, which the Floor drives when a task settles.
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

function restartRoute(opts: ClusterRoutesDeps): ServerRoute {
  return {
    method: "POST",
    path: "/api/cluster/restart",
    options: { auth: false },
    handler: (request, h) => {
      guard(opts, request.headers);
      const restart = opts.restart ?? (() => process.exit(0));

      // Deferred so the response reaches the caller before the process exits.
      setImmediate(restart);

      return h.response().code(204);
    },
  };
}
