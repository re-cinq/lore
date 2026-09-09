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
import { PgAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-pg.js";
import type { AssemblyRunsPort } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { withPool } from "../with-pool.js";
import { authenticateClusterAgent } from "./cluster-agent-auth.js";

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

type ReleaseResult =
  | { code: 200; body: z.infer<typeof ReleaseResponse> }
  | { code: 401 | 403 | 503; body: { error: string } };

/** Puts the unlaunched visit back on the queue and says so out loud: a run that keeps bouncing between clusters is only legible if each refusal names the agent and its reason. */
async function requeueAndLog(
  deps: ReleaseDeps,
  agentName: string,
  body: z.infer<typeof ReleaseBody>,
): Promise<"requeued" | "settled"> {
  const requeued = await deps.runs.requeueStationRun(body.node_row_id);

  console.warn(
    `[lore-api] cluster-agent ${agentName} could not launch station run row ${body.node_row_id} (${requeued ? "requeued" : "already settled"}): ${body.reason}`,
  );

  return requeued ? "requeued" : "settled";
}

/** The handler core, injectable for tests: authenticate, then requeue. */
export async function handleRelease(
  deps: ReleaseDeps,
  bearer: string | undefined,
  agentId: string,
  body: z.infer<typeof ReleaseBody>,
): Promise<ReleaseResult> {
  const auth = await authenticateClusterAgent(deps.agents, bearer, agentId);

  if ("code" in auth) {
    return auth;
  }

  return {
    code: 200,
    body: { status: await requeueAndLog(deps, auth.agent.name, body) },
  };
}

/** A cluster-agent handing back work it could not start. */
async function serveRelease(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const result = await handleRelease(
    { agents: new PgClusterAgents(pool), runs: new PgAssemblyRuns(pool) },
    extractBearer(request.headers.authorization),
    request.params.id,
    request.payload as z.infer<typeof ReleaseBody>,
  );

  return h.response(result.body).code(result.code);
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
    handler: withPool(getPool, serveRelease),
  };
}
