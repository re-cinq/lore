// Files between the Floor and a pod: GET is what the pod's init downloads before its agent starts (a plan, ADR-047; a digest draft, specs/daily-digest), POST is the file its supervisor uploads on exit. Both authenticate with the credential the pod already holds for its event sink, and neither carries the file through the event stream.

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
import {
  DIGEST_DRAFT_SOURCE,
  DIGEST_MESSAGE_EVENT,
} from "@re-cinq/lore-shared/digest/contract.js";
import { digestDraftOf } from "../../../work/digest/serve-draft.js";
import { receiveDigestUpload } from "../../../work/digest/deliver-digest.js";
import { draftDeps, uploadDeps } from "../../../work/digest/deps.js";

/** A plan outgrows hapi's 1 MB default long before it outgrows a pod. */
const MAX_PLAN_FILE_BYTES = 64 * 1024 * 1024;

const plans = () =>
  loreApiPlans(
    process.env.LORE_API_URL ?? "",
    process.env.LORE_INGEST_TOKEN ?? "",
  );

export const agentFileDownloadRoute: ServerRoute = {
  method: "GET",
  path: "/api/agent-files/runs/{runId}/{source}",
  options: { auth: "internal-token" },
  handler: async (request, h) => {
    const markdown = await inputFileOf(
      request.params.runId,
      request.params.source,
    );

    return markdown === null
      ? h
          .response({ error: `the run has no ${request.params.source}` })
          .code(404)
      : h.response(markdown).type("text/markdown; charset=utf-8").code(200);
  },
};

/** What a recipe's `inputs[].source` names, resolved for the run at the moment the pod asks; an unknown source is a file the run does not have. */
async function inputFileOf(
  runId: string,
  source: string,
): Promise<string | null> {
  if (source === "plan") {
    return planFileOf(runId, {
      planOfRun: async (id) => (await planRunOfRun(id))?.planId,
      plans: plans(),
    });
  }

  if (source === DIGEST_DRAFT_SOURCE) {
    return digestDraftOf(runId, draftDeps());
  }

  return null;
}

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
  if (request.params.event === DIGEST_MESSAGE_EVENT) {
    return receiveDigest(request, h);
  }
  enforceTrue(
    request.params.event === PLANNING_RESULT_EVENT,
    apiError(404),
    "no handler for this file event",
  );

  return receivePlan(request, h);
}

async function receivePlan(request: Request, h: ResponseToolkit) {
  const delivery = await receivePlanUpload(
    {
      agentCrName: request.params.agent,
      markdown: rawBytes(request).toString("utf8"),
      exitCode: exitCodeOf(request),
    },
    { planRunOfAgent, plans: plans() },
  );

  return delivery.outcome === "ready"
    ? h.response({ status: "ok" }).code(200)
    : h.response({ error: delivery.error }).code(404);
}

/** The uploaded digest.md posts to Slack right here; a failed or empty upload posts the stored draft instead, and a run already posted answers 200 without a second message. */
async function receiveDigest(request: Request, h: ResponseToolkit) {
  const delivery = await receiveDigestUpload(
    {
      agentCrName: request.params.agent,
      markdown: rawBytes(request).toString("utf8"),
      exitCode: exitCodeOf(request),
    },
    uploadDeps(),
  );

  return delivery.outcome === "skipped"
    ? h.response({ error: delivery.error }).code(404)
    : h.response({ status: delivery.outcome }).code(200);
}

// The supervisor sends how its agent exited; one that predates the header says nothing, and is taken at its word as before.
function exitCodeOf(request: Request): number | null {
  const code = Number.parseInt(
    String(request.headers["x-agent-exit-code"]),
    10,
  );

  return Number.isNaN(code) ? null : code;
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
