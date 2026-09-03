import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { extractBearer } from "@re-cinq/lore-shared/http/bearer.js";
import { apiError } from "../../../server/api-error.js";
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import type { ClusterAgentsRepository } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-port.js";
import { PgClusterAgents } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-pg.js";
import { PgAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-pg.js";
import type { AssemblyRunsPort } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { hashAgentToken } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agent-token.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

/** Release a failed claim: requeues it for another cluster to try instead of letting it linger. */

const ReleaseBody = z.object({
  node_row_id: z.string().min(1),
  /** Recorded in the log, so a claim that keeps bouncing names its own cause. */
  reason: z.string().min(1).max(2000),
});

const ReleaseResponse = z.object({
  status: z.enum(["requeued", "settled"]),
});

export interface ReleaseDeps {
  agents: ClusterAgentsRepository;
  runs: Pick<AssemblyRunsPort, "requeueStationRun">;
}

/** The handler core, injectable for tests: authenticate, then requeue. */
export async function handleRelease(
  deps: ReleaseDeps,
  bearer: string | undefined,
  agentId: string,
  body: z.infer<typeof ReleaseBody>,
): Promise<
  | { code: 200; body: z.infer<typeof ReleaseResponse> }
  | { code: 401 | 403 | 503; body: { error: string } }
> {
  if (!bearer) {
    return { code: 401, body: { error: "unauthorized" } };
  }

  const agent = await deps.agents.findByTokenHash(hashAgentToken(bearer));

  if (!agent || agent.id !== agentId) {
    return { code: 403, body: { error: "forbidden" } };
  }

  const requeued = await deps.runs.requeueStationRun(body.node_row_id);

  console.warn(
    `[lore-api] cluster-agent ${agent.name} could not launch station run row ${body.node_row_id} (${requeued ? "requeued" : "already settled"}): ${body.reason}`,
  );

  return { code: 200, body: { status: requeued ? "requeued" : "settled" } };
}

export function clusterAgentReleaseRoute(
  getPool: () => Pool | null,
): ServerRoute {
  return {
    method: "POST",
    path: "/api/cluster-agents/{id}/release",
    options: zodResponse(
      { auth: false, validate: { payload: zodValidate(ReleaseBody) } },
      ReleaseResponse,
      {
        name: "ClusterAgentRelease",
        description:
          "Whether the unlaunched visit went back on the queue or had already settled",
      },
    ),
    handler: async (request: Request, h: ResponseToolkit) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);

      const result = await handleRelease(
        { agents: new PgClusterAgents(pool), runs: new PgAssemblyRuns(pool) },
        extractBearer(request.headers.authorization),
        request.params.id,
        request.payload as z.infer<typeof ReleaseBody>,
      );

      return h.response(result.body).code(result.code);
    },
  };
}
