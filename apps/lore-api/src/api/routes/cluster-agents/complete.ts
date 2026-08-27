import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { extractBearer } from "@re-cinq/lore-shared/http/bearer.js";
import { apiError } from "../../../server/api-error.js";
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import type { ClusterAgentsRepository } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-port.js";
import { PgClusterAgents } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-pg.js";
import { hashAgentToken } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agent-token.js";
import type { AssemblyRunsPort } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { PgAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-pg.js";
import { zodValidate } from "../../../server/plugins/zod-validate.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

/**
 * POST /api/cluster-agents/{id}/complete — a cluster-agent reports what the
 * visit it claimed actually printed (FR4 of
 * specs/running-stations-in-any-k8s-cluster).
 *
 * The mirror of `claim`, and the reason it must exist: the Floor used to fetch
 * this output back out of Kubernetes through the one cluster-agent URL it holds,
 * which works only while every node runs in the central cluster. A satellite
 * cannot be dialled — pull-based, outbound-only, no URL in the registry — so the
 * result travels the same direction the claim came from.
 *
 * Same per-agent bearer auth as `claim`: a valid token may only report as
 * itself. Unlike `claim`, a PAUSED agent is served — pausing withholds new work,
 * it does not discard the work already in flight.
 *
 * 204, not 200: the reporter has nothing to read back, and a redelivered report
 * writes the same bytes over the same row.
 */

const CompleteRequest = z.object({
  station_run_id: z.string().min(1),
  /** The visit's whole terminal stream. Capped to its tail at the port. */
  output: z.string(),
});

export type CompleteRequestBody = z.infer<typeof CompleteRequest>;

export interface CompleteDeps {
  agents: ClusterAgentsRepository;
  runs: Pick<AssemblyRunsPort, "recordStationRunTerminalOutput">;
}

/** The handler core, injectable for tests: authenticate, then record. */
export async function handleComplete(
  deps: CompleteDeps,
  bearer: string | undefined,
  agentId: string,
  body: CompleteRequestBody,
): Promise<{ code: 204 } | { code: 401 | 403; body: { error: string } }> {
  if (!bearer) {
    return { code: 401, body: { error: "unauthorized" } };
  }

  const agent = await deps.agents.findByTokenHash(hashAgentToken(bearer));

  if (!agent || agent.id !== agentId) {
    return { code: 403, body: { error: "forbidden" } };
  }

  await deps.runs.recordStationRunTerminalOutput(
    body.station_run_id,
    body.output,
  );

  return { code: 204 };
}

export function clusterAgentCompleteRoute(
  getPool: () => Pool | null,
): ServerRoute {
  return {
    method: "POST",
    path: "/api/cluster-agents/{id}/complete",
    options: {
      auth: false,
      validate: { payload: zodValidate(CompleteRequest) },
    },
    handler: async (request: Request, h: ResponseToolkit) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const result = await handleComplete(
        {
          agents: new PgClusterAgents(pool),
          runs: new PgAssemblyRuns(pool),
        },
        extractBearer(request.headers.authorization),
        request.params.id,
        request.payload as CompleteRequestBody,
      );

      return result.code === 204
        ? h.response().code(204)
        : h.response(result.body).code(result.code);
    },
  };
}
