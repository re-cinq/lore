// Plan files between the Floor and a planning pod (ADR-047): GET is what the pod's init downloads before its agent starts, POST is the edited file its supervisor uploads on exit. Both authenticate with the credential the pod already holds for its event sink, and neither carries the plan through the event stream.

import type { Request, ResponseToolkit, ServerRoute } from "@hapi/hapi";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import { pipeline } from "../../../outbound/queues.js";
import { loreApiPlans } from "../../../outbound/lore-api-plans.js";
import {
  planFileOf,
  planRunRefOf,
  receivePlanUpload,
  PLANNING_RESULT_EVENT,
  type PlanRunRef,
} from "../../../work/agent/planning-result.js";
import { rawBytes } from "../raw-body.js";

/** A plan outgrows hapi's 1 MB default long before it outgrows a pod. */
const MAX_PLAN_FILE_BYTES = 64 * 1024 * 1024;

const plans = () =>
  loreApiPlans(
    process.env.LORE_API_URL ?? "",
    process.env.LORE_INGEST_TOKEN ?? "",
  );

export const agentFileDownloadRoute: ServerRoute = {
  method: "GET",
  path: "/api/agent-files/runs/{runId}/plan",
  options: { auth: "internal-token" },
  handler: async (request, h) => {
    const markdown = await planFileOf(request.params.runId, {
      planOfRun: async (runId) => (await planRunOfRun(runId))?.planId,
      plans: plans(),
    });

    return markdown === null
      ? h.response({ error: "the run drafts no plan" }).code(404)
      : h.response(markdown).type("text/markdown; charset=utf-8").code(200);
  },
};

export const agentFileUploadRoute: ServerRoute = {
  method: "POST",
  path: "/api/agent-files/{agent}/{event}",
  options: {
    auth: "internal-token",
    payload: { parse: false, maxBytes: MAX_PLAN_FILE_BYTES },
  },
  handler: receiveUpload,
};

async function receiveUpload(request: Request, h: ResponseToolkit) {
  enforceTrue(
    request.params.event === PLANNING_RESULT_EVENT,
    apiError(404),
    "no handler for this file event",
  );
  const delivery = await receivePlanUpload(
    request.params.agent,
    rawBytes(request).toString("utf8"),
    { planRunOfAgent, plans: plans() },
  );

  return delivery.outcome === "ready"
    ? h.response({ status: "ok" }).code(200)
    : h.response({ error: delivery.error }).code(404);
}

async function planRunOfRun(runId: string): Promise<PlanRunRef | undefined> {
  const run = await pipeline().assemblyRuns.getById(runId);

  return run ? planRunRefOf(run.args) : undefined;
}

async function planRunOfAgent(
  agentCrName: string,
): Promise<PlanRunRef | undefined> {
  const visit =
    await pipeline().assemblyRuns.findStationRunByAgentCrName(agentCrName);

  return visit ? planRunOfRun(visit.assemblyRunId) : undefined;
}
