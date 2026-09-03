// The cluster's Kubernetes surface, as HTTP — every route is a DOMAIN operation (never raw get/replace, no resourceVersion crosses the wire); list is ONE apiserver page per call since 180 CRs blew Node's heap on 2026-07-24.

import type { ServerRoute } from "@hapi/hapi";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type {
  Agent as AgentCr,
  AgentDefinition,
  Station,
} from "@re-cinq/agent-contracts";
import type {
  AgentPodInfo,
  PodSummary,
  RunningPodInfo,
} from "@re-cinq/lore-shared";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { enforceBearer } from "@re-cinq/lore-shared/http/bearer.js";

/** Page ceiling — a caller asking for more is refused rather than quietly served a smaller page (a silent clamp reads as "read everything"). */
const MAX_PAGE = 100;
/** Log tail ceiling, clamped HERE — the Floor's clamp no longer protects this process's heap. */
const MAX_TAIL = 10_000;

export interface ClusterDeps {
  agents: {
    get(name: string): Promise<AgentCr | null>;
    list(opts: {
      labelSelector?: string;
      limit: number;
      continue?: string;
    }): Promise<{ items: AgentCr[]; continueToken?: string }>;
    remove(name: string): Promise<void>;
  };
  pods: {
    agentInfo(name: string): Promise<AgentPodInfo | null>;
    podsForJob(jobName: string): Promise<PodSummary[]>;
    podLog(podName: string, tailLines?: number): Promise<string>;
    /** Every non-terminal run pod with the agent container's resource requests — the live half of the spend page's compute-cost estimate. */
    listRunning(): Promise<RunningPodInfo[]>;
  };
  tokens: {
    cleanup(taskId: string): Promise<void>;
  };
  catalog: {
    applyPair(pair: {
      agentDefinition: AgentDefinition;
      station: Station;
    }): Promise<void>;
    deletePair(name: string): Promise<void>;
  };
}

export interface ClusterRoutesDeps {
  /** A thunk: the Kubernetes clients are built lazily, after boot. */
  deps: () => ClusterDeps;
  bearerToken?: string;
  /** Defaults to `process.exit(0)`. Injectable so a test can observe the call without killing the test process. */
  restart?: () => void;
}

export function clusterRoutes(opts: ClusterRoutesDeps): ServerRoute[] {
  const guard = (headers: Record<string, unknown>): void =>
    enforceBearer(headers, opts.bearerToken);

  return [
    {
      // 200 with `found:false` rather than 404 — "no such CR" is an ordinary answer, and a 404 would be indistinguishable from the route being absent.
      method: "GET",
      path: "/api/cluster/agents/{name}",
      options: { auth: false },
      handler: async (request, h) => {
        guard(request.headers);
        const cr = await opts.deps().agents.get(request.params.name);

        return h.response({ found: cr !== null, cr }).code(200);
      },
    },
    {
      method: "GET",
      path: "/api/cluster/agents",
      options: { auth: false },
      handler: async (request, h) => {
        guard(request.headers);
        const q = request.query as Record<string, string | undefined>;
        const limit = Number(q.limit ?? MAX_PAGE);

        enforceTrue(
          Number.isInteger(limit) && limit > 0 && limit <= MAX_PAGE,
          apiError(400),
          `limit must be an integer in 1..${MAX_PAGE} — a larger page is what blew the heap on 2026-07-24`,
        );

        return h
          .response(
            await opts.deps().agents.list({
              labelSelector: q.labelSelector,
              limit,
              continue: q.continue,
            }),
          )
          .code(200);
      },
    },
    {
      method: "DELETE",
      path: "/api/cluster/agents/{name}",
      options: { auth: false },
      handler: async (request, h) => {
        guard(request.headers);
        await opts.deps().agents.remove(request.params.name);

        return h.response().code(204);
      },
    },
    {
      method: "GET",
      path: "/api/cluster/agents/{name}/pod-info",
      options: { auth: false },
      handler: async (request, h) => {
        guard(request.headers);
        const info = await opts.deps().pods.agentInfo(request.params.name);

        return h
          .response({
            found: info !== null,
            phase: info?.phase ?? null,
            jobName: info?.jobName ?? null,
          })
          .code(200);
      },
    },
    {
      method: "GET",
      path: "/api/cluster/jobs/{jobName}/pods",
      options: { auth: false },
      handler: async (request, h) => {
        guard(request.headers);

        return h
          .response({
            pods: await opts.deps().pods.podsForJob(request.params.jobName),
          })
          .code(200);
      },
    },
    {
      method: "GET",
      path: "/api/cluster/pods",
      options: { auth: false },
      handler: async (request, h) => {
        guard(request.headers);

        return h
          .response({ pods: await opts.deps().pods.listRunning() })
          .code(200);
      },
    },
    {
      method: "GET",
      path: "/api/cluster/pods/{podName}/log",
      options: { auth: false },
      handler: async (request, h) => {
        guard(request.headers);
        const asked = Number(
          (request.query as Record<string, string | undefined>).tail ??
            MAX_TAIL,
        );
        const tail = Number.isInteger(asked) && asked > 0 ? asked : MAX_TAIL;

        return h
          .response({
            logs: await opts
              .deps()
              .pods.podLog(request.params.podName, Math.min(tail, MAX_TAIL)),
          })
          .code(200);
      },
    },
    {
      // The mint side is NOT a route — every launch is an in-process claim; what crosses the network is the reclaim, which the Floor drives when a task settles.
      method: "DELETE",
      path: "/api/cluster/per-task-tokens/{taskId}",
      options: { auth: false },
      handler: async (request, h) => {
        guard(request.headers);
        await opts.deps().tokens.cleanup(request.params.taskId);

        return h.response().code(204);
      },
    },
    {
      method: "POST",
      path: "/api/cluster/restart",
      options: { auth: false },
      handler: (request, h) => {
        guard(request.headers);
        const restart = opts.restart ?? (() => process.exit(0));

        // Deferred so the response reaches the caller before the process exits.
        setImmediate(restart);

        return h.response().code(204);
      },
    },
  ];
}
