import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { extractBearer } from "@re-cinq/lore-shared/http/bearer.js";
import { apiError } from "../../../server/api-error.js";
import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import type { ClusterAgentsRepository } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-port.js";
import { PgClusterAgents } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agents-pg.js";
import { hashAgentToken } from "@re-cinq/lore-shared/project/cluster-agents/cluster-agent-token.js";
import { mayClaim } from "@re-cinq/lore-shared/project/cluster-agents/capacity.js";
import type { AssemblyRunsPort } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { PgAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-pg.js";
import { zodResponse } from "../../../server/plugins/zod-response.js";
import { DB_UNAVAILABLE } from "../common-schemas.js";

/**
 * POST /api/cluster-agents/{id}/claim — a cluster-agent pulls its next queued
 * station run (FR3 of specs/running-stations-in-any-k8s-cluster).
 *
 * Auth is the per-agent bearer token issued at registration, NOT the
 * bearer-scope strategy: the token identifies the claiming agent, and a valid
 * token may only claim as itself — presenting agent A's token against agent
 * B's id is a 403, not a claim on B's behalf.
 *
 * No matching queued run is a 204, the idle-poll signal an agent backs off on.
 */

const ClaimResponse = z.object({
  station_run_id: z.string(),
  node_row_id: z.string(),
  assembly_run_id: z.string(),
  node_id: z.string(),
  iteration: z.number(),
  agent_cr_name: z.string().nullable(),
  /** The LoreTaskSpec the visit was enqueued with, carried opaquely. */
  spec: z.unknown(),
});

export interface ClaimDeps {
  agents: ClusterAgentsRepository;
  runs: Pick<AssemblyRunsPort, "claimNextStationRun">;
}

/** The handler core, injectable for tests: authenticate, match, claim. */
export async function handleClaim(
  deps: ClaimDeps,
  bearer: string | undefined,
  agentId: string,
): Promise<
  | { code: 200; body: z.infer<typeof ClaimResponse> }
  | { code: 204 }
  | { code: 401 | 403 | 503; body: { error: string } }
> {
  if (!bearer) {
    return { code: 401, body: { error: "unauthorized" } };
  }

  const agent = await deps.agents.findByTokenHash(hashAgentToken(bearer));

  if (!agent || agent.id !== agentId) {
    return { code: 403, body: { error: "forbidden" } };
  }

  if (!mayClaim(agent)) {
    // 204, the same answer as "nothing queued for you": a paused agent needs
    // no new client behaviour, its existing idle backoff simply keeps polling
    // until an operator un-pauses it. Enforced HERE rather than in the claim
    // SQL because pausing is a fact about the cluster-agent, and the station-run
    // queue has no business knowing about the registry.
    return { code: 204 };
  }

  const claimed = await deps.runs.claimNextStationRun({
    clusterAgentId: agent.id,
    tags: agent.tags,
  });

  if (!claimed) {
    return { code: 204 };
  }

  return {
    code: 200,
    body: {
      station_run_id: claimed.stationRunId,
      node_row_id: claimed.nodeRowId,
      assembly_run_id: claimed.assemblyRunId,
      node_id: claimed.nodeId,
      iteration: claimed.iteration,
      agent_cr_name: claimed.agentCrName,
      spec: claimed.dispatchSpec,
    },
  };
}

export function clusterAgentClaimRoute(
  getPool: () => Pool | null,
): ServerRoute {
  return {
    method: "POST",
    path: "/api/cluster-agents/{id}/claim",
    options: zodResponse(
      {
        auth: false,
      },
      ClaimResponse,
      {
        name: "ClusterAgentClaim",
        description:
          "The claimed station run's identity plus the dispatch spec it was enqueued with; 204 when nothing is claimable",
      },
    ),
    handler: async (request: Request, h: ResponseToolkit) => {
      const pool = getPool();

      enforceTrue(pool, apiError(503), DB_UNAVAILABLE);
      const bearer = extractBearer(request.headers.authorization);

      const result = await handleClaim(
        {
          agents: new PgClusterAgents(pool),
          runs: new PgAssemblyRuns(pool),
        },
        bearer,
        request.params.id,
      );

      if (result.code === 204) {
        return h.response().code(204);
      }

      return h.response(result.body).code(result.code);
    },
  };
}
