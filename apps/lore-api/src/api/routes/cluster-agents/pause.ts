import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "../../../server/api-error.js";
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import type { ClusterAgentsRepository } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-port.js";
import { PgClusterAgents } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-pg.js";
import { bearerScope } from "../../../server/plugins/bearer-scope.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

/** Stop-switch: pauses a cluster without taking it down; stays active and finishes claimed work (FR9). */

const PauseBody = z.object({ paused: z.boolean() });

type PauseBody = z.infer<typeof PauseBody>;

const PauseResponse = z.object({
  id: z.string(),
  name: z.string(),
  paused: z.boolean(),
});

export interface PauseDeps {
  agents: Pick<ClusterAgentsRepository, "setPaused">;
}

/** The handler core, injectable for tests. */
export async function handleSetPaused(
  deps: PauseDeps,
  id: string,
  body: PauseBody,
): Promise<
  | { code: 200; body: z.infer<typeof PauseResponse> }
  | { code: 404; body: { error: string } }
> {
  const agent = await deps.agents.setPaused(id, body.paused);

  if (!agent) {
    return { code: 404, body: { error: "cluster agent not found" } };
  }

  return {
    code: 200,
    body: { id: agent.id, name: agent.name, paused: agent.paused },
  };
}

export function clusterAgentPauseRoute(
  getPool: () => Pool | null,
): ServerRoute {
  return {
    method: "PUT",
    path: "/api/cluster-agents/{id}/paused",
    options: zodResponse(
      {
        ...bearerScope("write"),
        validate: { payload: zodValidate(PauseBody) },
      },
      PauseResponse,
      {
        name: "ClusterAgentPause",
        description:
          "The cluster-agent's new paused state — paused agents are passed over when work is handed out, but stay alive and finish what they hold",
        errors: [404],
      },
    ),
    handler: async (request: Request, h: ResponseToolkit) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

      const result = await handleSetPaused(
        { agents: new PgClusterAgents(pool) },
        request.params.id,
        request.payload as PauseBody,
      );

      return h.response(result.body).code(result.code);
    },
  };
}
