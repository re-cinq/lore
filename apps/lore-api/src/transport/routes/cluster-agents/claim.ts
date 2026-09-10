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
import type {
  AssemblyRunsPort,
  ClaimedStationRun,
} from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { PgAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-pg.js";
import { zodResponse } from "../../http/zod-response.js";
import { withPool } from "../with-pool.js";
import {
  authenticateClusterAgent,
  type ClusterAgentRefusal,
} from "./cluster-agent-auth.js";
import type { ClusterAgent } from "@re-cinq/lore-shared/models/cluster-agent.js";
import type { LoreTaskSpec } from "@re-cinq/lore-shared/project/agents/k8s-port.js";
import { signRunCredential } from "@re-cinq/lore-shared/github-credential/run-credential.js";
import { runCredentialKey } from "../../../work/github-credential/run-credential-key.js";

/** How long a run credential stays valid; the broker also refuses once the run closes, so this only bounds a leak. */
const RUN_CREDENTIAL_TTL_MS = 24 * 60 * 60 * 1000;

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
  /** The run credential the pod trades at POST /api/github-credentials for a token scoped to its repo (ADR-031 amendment 2026-09-10). */
  git_credential: z.string(),
});

export interface ClaimDeps {
  agents: ClusterAgentsRepository;
  runs: Pick<AssemblyRunsPort, "claimNextStationRun">;
  key: string;
  now: () => Date;
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
    {
      agents: new PgClusterAgents(pool),
      runs: new PgAssemblyRuns(pool),
      key: runCredentialKey(process.env),
      now: () => new Date(),
    },
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

  return { code: 200, body: claimBody(claimed, deps) };
}

/** What a claiming agent is handed. The `spec` rides ALONG with the ids: the claim armed it, and re-deriving it in the cluster would let a re-dispatch build something different from what was claimed. */
function claimBody(
  claimed: NonNullable<
    Awaited<ReturnType<ClaimDeps["runs"]["claimNextStationRun"]>>
  >,
  deps: Pick<ClaimDeps, "key" | "now">,
): z.infer<typeof ClaimResponse> {
  return {
    git_credential: issueRunCredential(claimed, deps),
    station_run_id: claimed.stationRunId,
    node_row_id: claimed.nodeRowId,
    assembly_run_id: claimed.assemblyRunId,
    node_id: claimed.nodeId,
    iteration: claimed.iteration,
    agent_cr_name: claimed.agentCrName,
    spec: claimed.dispatchSpec,
  };
}

/** A credential for exactly this station run and the repo its spec targets; the pod trades it at the broker for a token minted then. */
function issueRunCredential(
  claimed: ClaimedStationRun,
  deps: Pick<ClaimDeps, "key" | "now">,
): string {
  return signRunCredential(
    {
      stationRunId: claimed.stationRunId,
      repo: (claimed.dispatchSpec as LoreTaskSpec).targetRepo,
      expiresAt: new Date(
        deps.now().getTime() + RUN_CREDENTIAL_TTL_MS,
      ).toISOString(),
    },
    deps.key,
  );
}
