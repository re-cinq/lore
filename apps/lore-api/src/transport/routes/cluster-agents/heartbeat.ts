import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import type { ClusterAgentsRepository } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-port.js";
import { PgClusterAgents } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-pg.js";
import { zodResponse } from "../../http/zod-response.js";
import { withPool } from "../with-pool.js";
import { authenticateClusterAgent } from "./cluster-agent-auth.js";
import { extractBearer } from "@re-cinq/lore-shared/http/bearer.js";

/** Liveness heartbeat: bumps last_seen_at, revives offline agents to active. */

const HeartbeatResponse = z.object({ status: z.literal("ok") });

export interface HeartbeatDeps {
  agents: ClusterAgentsRepository;
  now: () => Date;
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
    handler: withPool(getPool, serveHeartbeat),
  };
}

/** A cluster-agent saying it is still there. */
async function serveHeartbeat(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const result = await handleHeartbeat(
    { agents: new PgClusterAgents(pool), now: () => new Date() },
    extractBearer(request.headers.authorization),
    request.params.id,
  );

  return h.response(result.body).code(result.code);
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
  const auth = await authenticateClusterAgent(deps.agents, bearer, agentId);

  if ("code" in auth) {
    return auth;
  }

  await deps.agents.heartbeat(auth.agent.id, deps.now());

  return { code: 200, body: { status: "ok" } };
}
