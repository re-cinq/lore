import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { errorMessage } from "@re-cinq/lore-shared";
import type { Pool } from "pg";
import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";
import { agentUsage } from "../../../features/analytics/usage-queries.js";

// Required, not resolved server-side: agent identity lives on the caller's machine, resolving it here would report the pod's identity instead.
const UsageQuery = z.object({ agent_id: z.string().min(1).max(200) });

type UsageQuery = z.infer<typeof UsageQuery>;

/** Per-agent token and cost usage. An aggregate, so its keys are the query's. */
const AgentUsageSchema = z.record(z.unknown());

export function usageRoute(getPool: () => Pool | null): ServerRoute {
  return {
    method: "GET",
    path: "/api/usage",
    options: zodResponse(
      {
        ...bearerScope("read"),
        validate: { query: zodValidate(UsageQuery) },
      },
      AgentUsageSchema,
      { name: "AgentUsage", description: "Token and cost usage for an agent" },
    ),
    handler: async (request, h) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

      const { agent_id } = request.query as unknown as UsageQuery;

      try {
        return h.response(await agentUsage(pool, agent_id));
      } catch (err) {
        return h.response({ error: errorMessage(err) }).code(500);
      }
    },
  };
}
