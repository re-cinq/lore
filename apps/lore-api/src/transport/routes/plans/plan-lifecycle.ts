// A plan's life after its people are done writing: approval, reopening, and a fresh spec pass. These wrap the library's own approve/reopen with what the planning line needs first — a refusal lands BEFORE the status flips, so an approval can never strand a plan the agent is still writing.

import type {
  Request,
  ResponseObject,
  ResponseToolkit,
  ServerRoute,
} from "@hapi/hapi";
import type { Pool } from "pg";
import { z } from "zod";
import { planMetaSchema, type PlanMeta } from "@re-cinq/planning-document";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import {
  approveOrRefuse,
  type PlanApprover,
} from "../../../work/plans/plan-approval.js";
import { NOT_APPROVED } from "../../../work/plans/planning-line.js";
import { pgPlanStore } from "../../../outbound/plans/plan-store-pg.js";
import { planVerbsFor, type PlanVerbSeams } from "./plan-verbs-for.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { withPool } from "../with-pool.js";

const BASE = "/api/repos/{owner}/{repo}/plans/{id}";

export interface PlanLifecyclePorts extends PlanVerbSeams {
  service: PlanApprover & { reopenPlan(planId: string): Promise<PlanMeta> };
  getPool: () => Pool | null;
}

export function planLifecycleRoutes(ports: PlanLifecyclePorts): ServerRoute[] {
  const { getPool } = ports;
  const lifecycle = (
    path: string,
    options: ServerRoute["options"],
    serve: Serve,
  ) =>
    lifecycleRoute(getPool, path, options, (pool, request, h) =>
      serve(ports, pool, request, h),
    );

  return [
    lifecycle("approve", APPROVE_OPTIONS, serveApprove),
    lifecycle("reopen", REOPEN_OPTIONS, serveReopen),
    lifecycle("spec-work", SPEC_WORK_OPTIONS, serveSpecWork),
    lifecycle("spec-rework", SPEC_REWORK_OPTIONS, serveSpecRework),
    lifecycle("validate", VALIDATE_OPTIONS, serveValidate),
    lifecycle("author-waiting", AUTHOR_WAITING_OPTIONS, serveAuthorWaiting),
  ];
}

type Serve = (
  ports: PlanLifecyclePorts,
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
) => Promise<ResponseObject>;

function lifecycleRoute(
  getPool: PlanLifecyclePorts["getPool"],
  path: string,
  options: ServerRoute["options"],
  serve: (
    pool: Pool,
    request: Request,
    h: ResponseToolkit,
  ) => Promise<ResponseObject>,
): ServerRoute {
  return {
    method: "POST",
    path: `${BASE}/${path}`,
    options,
    handler: withPool(getPool, serve),
  };
}

const ApproveBody = z.object({ approvedBy: z.string().min(1) });
const ReopenBody = z.object({ reopenedBy: z.string().min(1) });
const SpecWorkBody = z.object({ createdBy: z.string().min(1) });
const SpecWorkSchema = z.object({ task_id: z.string() });

const APPROVE_OPTIONS = zodResponse(
  { ...bearerScope("write"), validate: { payload: zodValidate(ApproveBody) } },
  planMetaSchema,
  {
    name: "PlanApproved",
    description:
      "The plan is approved and its planning line moves on to the spec work; refused while the planning agent is still writing it",
    errors: [404, 409],
  },
);

const REOPEN_OPTIONS = zodResponse(
  { ...bearerScope("write"), validate: { payload: zodValidate(ReopenBody) } },
  planMetaSchema,
  {
    name: "PlanReopened",
    description:
      "The approved plan is open for writing again; an open spec PR is sent back to the author",
    errors: [404, 409],
  },
);

const SPEC_WORK_OPTIONS = zodResponse(
  { ...bearerScope("write"), validate: { payload: zodValidate(SpecWorkBody) } },
  SpecWorkSchema,
  {
    name: "PlanSpecWorkStarted",
    status: 202,
    description:
      "A fresh spec pass for an approved plan whose line is not running: after a failed pass, or to revise merged specs",
    errors: [404, 409],
  },
);

const SpecReworkBody = z.object({ actor: z.string().min(1) });
const SpecReworkSchema = z.object({ run_id: z.string() });

const SPEC_REWORK_OPTIONS = zodResponse(
  {
    ...bearerScope("write"),
    validate: { payload: zodValidate(SpecReworkBody) },
  },
  SpecReworkSchema,
  {
    name: "PlanSpecReworkStarted",
    status: 202,
    description:
      "The spec writer runs again in the same line with the spec PR's unresolved review: the specs are amended on the PR's branch, and whatever contradicts the plan comes back to it as questions",
    errors: [404, 409],
  },
);

const PlanValidateBody = z.object({ actor: z.string().min(1) });
const PlanValidateSchema = z.object({ run_id: z.string() });

const VALIDATE_OPTIONS = zodResponse(
  {
    ...bearerScope("write"),
    validate: { payload: zodValidate(PlanValidateBody) },
  },
  PlanValidateSchema,
  {
    name: "PlanValidateStarted",
    status: 202,
    description:
      "Runs the plan validator over a draft plan parked on its author; findings land in the plan",
    errors: [404, 409],
  },
);

const AuthorWaitingSchema = z.object({ reopened: z.boolean() });

const AUTHOR_WAITING_OPTIONS = zodResponse(
  bearerScope("write"),
  AuthorWaitingSchema,
  {
    name: "PlanOpenedForAuthor",
    description:
      "The planning line parked on the plan's author: an approved plan is reopened so its people can answer; any other plan is left as it is",
    errors: [404],
  },
);

async function serveAuthorWaiting(
  ports: PlanLifecyclePorts,
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
) {
  const { plan, verbs } = await planWithVerbs(ports, pool, request);
  const reopened = await verbs.openForAuthor(plan, (planId) =>
    ports.service.reopenPlan(planId),
  );

  return h.response({ reopened });
}

async function serveApprove(
  ports: PlanLifecyclePorts,
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
) {
  const { plan, verbs } = await planWithVerbs(ports, pool, request);
  const { approvedBy } = request.payload as z.infer<typeof ApproveBody>;
  const decision = await verbs.approvalDecision(plan);

  enforceTrue(
    decision.kind !== "refused",
    apiError(409),
    decision.kind === "refused" ? decision.reason : "",
  );

  return h.response(await approveOrRefuse(ports.service, plan.id, approvedBy));
}

async function serveReopen(
  ports: PlanLifecyclePorts,
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
) {
  const { plan, verbs } = await planWithVerbs(ports, pool, request);
  const { reopenedBy } = request.payload as z.infer<typeof ReopenBody>;

  enforceTrue(plan.status === "approved", apiError(409), NOT_APPROVED);
  await verbs.reopen(plan, reopenedBy);

  return h.response(await ports.service.reopenPlan(plan.id));
}

async function serveSpecWork(
  ports: PlanLifecyclePorts,
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
) {
  const { plan, verbs } = await planWithVerbs(ports, pool, request);
  const { createdBy } = request.payload as z.infer<typeof SpecWorkBody>;

  return h
    .response({ task_id: await verbs.startSpecWork(plan, createdBy) })
    .code(202);
}

// The two routes that ask for a run by hand answer the same way: the run's id once it is asked for.
function servesRun(verb: "reworkSpec" | "validate"): Serve {
  return async (ports, pool, request, h) => {
    const { plan, verbs } = await planWithVerbs(ports, pool, request);
    const { actor } = request.payload as z.infer<typeof SpecReworkBody>;

    return h.response({ run_id: await verbs[verb](plan, actor) }).code(202);
  };
}

const serveSpecRework = servesRun("reworkSpec");

const serveValidate = servesRun("validate");

// The plan the path names, with the verbs of the engine that holds its planning line.
async function planWithVerbs(
  ports: PlanLifecyclePorts,
  pool: Pool,
  request: Request,
) {
  const plan = await repoPlan(() => pool, request);

  return { plan, verbs: await planVerbsFor(plan, ports) };
}

// The plan the path names, only when it belongs to the path's repo.
async function repoPlan(db: () => Pool, request: Request): Promise<PlanMeta> {
  const meta = await pgPlanStore(db).getMeta(String(request.params.id));
  const repo = `${request.params.owner}/${request.params.repo}`;

  enforceTrue(meta?.repo === repo, apiError(404), "plan not found");

  return meta;
}
