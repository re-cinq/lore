import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { zodResponse } from "../../http/zod-response.js";
import { errorMessage } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import { z } from "zod";
import { isMemoryDbAvailable } from "@re-cinq/lore-server-core/features/memory/memory.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodValidate } from "../../http/zod-validate.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";
import { agentStatsBundle } from "../../../work/analytics/agent-stats-queries.js";

// Same reason as /api/usage: agent identity is the caller's — resolving it server-side would report the pod's.
const AgentStatsQuery = z.object({ agent_id: z.string().min(1).max(200) });

type AgentStatsQuery = z.infer<typeof AgentStatsQuery>;

/** An agent's health bundle: memory, episode, fact and search counters. */
const AgentStatsSchema = z.record(z.string(), z.unknown());

export function agentStatsRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/agent-stats",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { query: zodValidate(AgentStatsQuery) },
      },
      AgentStatsSchema,
      {
        name: "AgentStats",
        description: "Health and activity counters for an agent",
      },
    ),
    handler: (request, h) => serveAgentStats(getPool, request, h),
  };
}

async function serveAgentStats(
  getPool: () => Pool | null,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const pool = getPool();

  enforceTrue(pool && isMemoryDbAvailable(), apiError(503), DB_UNAVAILABLE);

  const { agent_id } = request.query as unknown as AgentStatsQuery;

  try {
    return h.response(await agentStatsBundle(pool, agent_id));
  } catch (err) {
    return h.response({ error: errorMessage(err) }).code(500);
  }
}
