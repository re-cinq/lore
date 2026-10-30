import type { ServerRoute } from "@hapi/hapi";
import { z } from "zod";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { floorIfConfigured } from "@re-cinq/lore-shared/floor/floor-client.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { readDefinitionActivity } from "../../../work/agents/definition-activity.js";

const ActivityResponse = z.object({
  since: z.string(),
  activity: z.array(
    z.object({
      name: z.string(),
      visits: z.number(),
      cost_usd: z.number(),
      tokens_in: z.number(),
      tokens_out: z.number(),
    }),
  ),
});

export function agentDefinitionActivityRoute(): ServerRoute {
  return {
    method: "GET",
    path: "/api/agent-definitions/activity",
    options: zodResponse(bearerScope("read"), ActivityResponse, {
      name: "AgentDefinitionActivity",
      description:
        "Each agent definition's floor visits, cost and tokens over the last 30 days; 503 on a deployment given no floor, whose activity is unknown rather than none",
    }),
    handler: async (_request, h) => {
      const floor = floorIfConfigured();

      enforceTrue(floor, apiError(503), "floor unavailable");

      return h.response(
        activityResponse(await readDefinitionActivity(floor, new Date())),
      );
    },
  };
}

/** The wire's snake_case from the floor read. */
function activityResponse({
  since,
  activity,
}: Awaited<ReturnType<typeof readDefinitionActivity>>) {
  return {
    since,
    activity: activity.map((entry) => ({
      name: entry.name,
      visits: entry.visits,
      cost_usd: entry.costUsd,
      tokens_in: entry.tokensIn,
      tokens_out: entry.tokensOut,
    })),
  };
}
