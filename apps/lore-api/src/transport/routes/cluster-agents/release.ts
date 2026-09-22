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
import {
  launchAttemptsFromEnv,
  launchReleaseOf,
} from "@re-cinq/lore-shared/project/assembly-runs/launch-release.js";

/** Release a failed claim: requeues it for another cluster to try, or fails it when no retry can launch it, so one hopeless visit never holds the head of the claim queue (#2006). */

const ReleaseBody = z.object({
  node_row_id: z.string().min(1),
  /** Recorded in the log, so a claim that keeps bouncing names its own cause. */
  reason: z.string().min(1).max(2000),
});

const ReleaseResponse = z.object({
  status: z.enum(["requeued", "failed", "settled"]),
});

export interface ReleaseDeps {
  agents: ClusterAgentsRepository;
  runs: Pick<AssemblyRunsPort, "releaseStationRun">;
  maxLaunchAttempts: number;
}

type ReleaseResult =
  | { code: 200; body: z.infer<typeof ReleaseResponse> }
  | { code: 401 | 403 | 503; body: { error: string } };

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
          "Whether the unlaunched visit went back on the queue, failed because no retry can launch it, or had already settled",
      },
    ),
    handler: withPool(getPool, serveRelease),
  };
}

/** A cluster-agent handing back work it could not start. */
async function serveRelease(
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> {
  const result = await handleRelease(
    {
      agents: new PgClusterAgents(pool),
      runs: new PgAssemblyRuns(pool),
      maxLaunchAttempts: launchAttemptsFromEnv(process.env),
    },
    extractBearer(request.headers.authorization),
    request.params.id,
    request.payload as z.infer<typeof ReleaseBody>,
  );

  return h.response(result.body).code(result.code);
}

/** The handler core, injectable for tests: authenticate, then release. */
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
    body: { status: await releaseAndLog(deps, auth.agent.name, body) },
  };
}

/** Requeues or fails the unlaunched visit and says so out loud: a run that bounces between clusters is only legible if each refusal names the agent, its reason, and what became of the visit. */
async function releaseAndLog(
  deps: ReleaseDeps,
  agentName: string,
  body: z.infer<typeof ReleaseBody>,
): Promise<"requeued" | "failed" | "settled"> {
  const release = launchReleaseOf(body.reason, deps.maxLaunchAttempts);
  const status = await deps.runs.releaseStationRun(body.node_row_id, release);

  console.warn(
    `[lore-api] cluster-agent ${agentName} could not launch station run row ${body.node_row_id} (${status}, ${release.failureClass}): ${body.reason}`,
  );

  return status;
}
