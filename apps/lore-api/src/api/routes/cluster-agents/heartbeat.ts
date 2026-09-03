import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import type { ClusterAgentsRepository } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-port.js";
import { PgClusterAgents } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-pg.js";
import { hashAgentToken } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agent-token.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

/** Liveness heartbeat: bumps last_seen_at, revives offline agents to active. */

const HeartbeatResponse = z.object({ status: z.literal("ok") });

export interface HeartbeatDeps {
  agents: ClusterAgentsRepository;
  now: () => Date;
}

/** The handler core, injectable for tests: authenticate, bump, revive. */
export async function handleHeartbeat(
  deps: HeartbeatDeps,
  bearer: string | undefined,
  agentId: string,
): Promise<
  | { code: 200; body: z.infer<typeof HeartbeatResponse> }
  | { code: 401 | 403 | 503; body: { error: string } }
> {
  if (!bearer) {
    return { code: 401, body: { error: "unauthorized" } };
  }

  const agent = await deps.agents.findByTokenHash(hashAgentToken(bearer));

  if (!agent || agent.id !== agentId) {
    return { code: 403, body: { error: "forbidden" } };
  }

  await deps.agents.heartbeat(agent.id, deps.now());

  return { code: 200, body: { status: "ok" } };
}

export function clusterAgentHeartbeatRoute(
  getPool: () => Pool | null,
): ServerRoute {
  return {
    method: "POST",
    path: "/api/cluster-agents/{id}/heartbeat",
    options: zodResponse({ auth: false }, HeartbeatResponse, {
      name: "ClusterAgentHeartbeat",
      description: "Liveness acknowledgement; last_seen_at was bumped",
    }),
    handler: async (request: Request, h: ResponseToolkit) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const authHeader = request.headers.authorization;
      const bearer = (
        Array.isArray(authHeader) ? authHeader[0] : authHeader
      )?.replace("Bearer ", "");

      const result = await handleHeartbeat(
        { agents: new PgClusterAgents(pool), now: () => new Date() },
        bearer,
        request.params.id,
      );

      return h.response(result.body).code(result.code);
    },
  };
}
