import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import type { ClusterAgentsRepository } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-port.js";
import { PgClusterAgents } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-pg.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";
import { restartClusterAgent } from "../../../features/agents/agent-crd-k8s.js";

/** Bounces the cluster-agent pod to re-pull latest image; only central agent is reachable. */

const CENTRAL_CLUSTER_AGENT_NAME = "central";

const RestartResponse = z.object({
  id: z.string(),
  name: z.string(),
  restarted: z.boolean(),
});

export interface RestartDeps {
  agents: Pick<ClusterAgentsRepository, "findById">;
  restart: () => Promise<void>;
}

/** The handler core, injectable for tests. */
export async function handleRestart(
  deps: RestartDeps,
  id: string,
): Promise<
  | { code: 200; body: z.infer<typeof RestartResponse> }
  | { code: 400; body: { error: string } }
  | { code: 404; body: { error: string } }
> {
  const agent = await deps.agents.findById(id);

  if (!agent) {
    return { code: 404, body: { error: "cluster agent not found" } };
  }

  if (agent.name !== CENTRAL_CLUSTER_AGENT_NAME) {
    return {
      code: 400,
      body: {
        error:
          "only the central cluster-agent is reachable from lore-api — a satellite has no inbound path",
      },
    };
  }

  await deps.restart();

  return {
    code: 200,
    body: { id: agent.id, name: agent.name, restarted: true },
  };
}

export function clusterAgentRestartRoute(
  getPool: () => Pool | null,
): ServerRoute {
  return {
    method: "POST",
    path: "/api/cluster-agents/{id}/restart",
    options: zodResponse(bearerScope("write"), RestartResponse, {
      name: "ClusterAgentRestart",
      description:
        "Bounces the central cluster-agent so it re-pulls the latest image on restart. Refused for a satellite — lore-api has no inbound path to it.",
      errors: [400, 404],
    }),
    handler: async (request: Request, h: ResponseToolkit) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

      const result = await handleRestart(
        { agents: new PgClusterAgents(pool), restart: restartClusterAgent },
        request.params.id,
      );

      return h.response(result.body).code(result.code);
    },
  };
}
