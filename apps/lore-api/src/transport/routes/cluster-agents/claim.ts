import { extractBearer } from "@re-cinq/lore-shared/http/bearer.js";
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
import { mayClaim } from "@re-cinq/lore-shared/project/cluster-agents/capacity.js";
import type { AssemblyRunsPort } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { PgAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-pg.js";
import { zodResponse } from "../../http/zod-response.js";
import { withPool } from "../with-pool.js";
import {
  authenticateClusterAgent,
  type ClusterAgentRefusal,
} from "./cluster-agent-auth.js";
import type { ClusterAgent } from "@re-cinq/lore-shared/models/cluster-agent.js";

// A cluster-agent pulls its next queued station run (FR3, specs/running-stations-in-any-k8s-cluster); per-agent bearer token (not bearer-scope) so A's token against B's id is a 403; no queued run is a 204 idle-poll signal.

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

/** Every way a claim ends without work being handed over. */
type ClaimRefusal = ClusterAgentRefusal | { code: 204 };

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
    handler: withPool(getPool, serveClaim),
  };
}

/** A cluster-agent asking for work. Dispatch is PULL-only, so this is the one path by which a run reaches any cluster — including the platform's own. */
async function serveClaim(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const result = await handleClaim(
    { agents: new PgClusterAgents(pool), runs: new PgAssemblyRuns(pool) },
    extractBearer(request.headers.authorization),
    request.params.id,
  );

  if (result.code === 204) {
    return h.response().code(204);
  }

  return h.response(result.body).code(result.code);
}

export async function handleClaim(
  deps: ClaimDeps,
  bearer: string | undefined,
  agentId: string,
): Promise<
  | { code: 200; body: z.infer<typeof ClaimResponse> }
  | { code: 204 }
  | { code: 401 | 403 | 503; body: { error: string } }
> {
  const authorized = await authorizeClaimant(deps, bearer, agentId);

  if ("code" in authorized) {
    return authorized;
  }

  return claimNextRun(deps, authorized.agent);
}

/** The handler core, injectable for tests: authenticate, match, claim. */
/** Who is asking, and whether they may claim at all. A PAUSED agent gets the same 204 as "nothing queued" — it needs no new client behaviour, just its existing idle backoff — and the check lives here because pausing is a fact about the registry, not about the queue. */
async function authorizeClaimant(
  deps: ClaimDeps,
  bearer: string | undefined,
  agentId: string,
): Promise<{ agent: ClusterAgent } | ClaimRefusal> {
  const auth = await authenticateClusterAgent(deps.agents, bearer, agentId);

  if ("code" in auth) {
    return auth;
  }

  return mayClaim(auth.agent) ? auth : { code: 204 };
}

/** The next queued run for this agent's tags, or the 204 that tells it to keep polling. */
async function claimNextRun(
  deps: ClaimDeps,
  agent: ClusterAgent,
): Promise<{ code: 200; body: z.infer<typeof ClaimResponse> } | { code: 204 }> {
  const claimed = await deps.runs.claimNextStationRun({
    clusterAgentId: agent.id,
    tags: agent.tags,
  });

  if (!claimed) {
    return { code: 204 };
  }

  return { code: 200, body: claimBody(claimed) };
}

/** What a claiming agent is handed. The `spec` rides ALONG with the ids: the claim armed it, and re-deriving it in the cluster would let a re-dispatch build something different from what was claimed. */
function claimBody(
  claimed: NonNullable<
    Awaited<ReturnType<ClaimDeps["runs"]["claimNextStationRun"]>>
  >,
): z.infer<typeof ClaimResponse> {
  return {
    station_run_id: claimed.stationRunId,
    node_row_id: claimed.nodeRowId,
    assembly_run_id: claimed.assemblyRunId,
    node_id: claimed.nodeId,
    iteration: claimed.iteration,
    agent_cr_name: claimed.agentCrName,
    spec: claimed.dispatchSpec,
  };
}
