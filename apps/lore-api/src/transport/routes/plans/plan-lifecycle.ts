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
import { planLineState } from "@re-cinq/lore-shared/project/plans/plan-run.js";
import {
  approveOrRefuse,
  type PlanApprover,
} from "../../../work/plans/plan-approval.js";
import {
  decideApproval,
  openForAuthor,
  reopenPlan,
  startSpecWork,
} from "../../../work/plans/planning-line.js";
import { startSpecRework } from "../../../work/plans/spec-rework.js";
import { startPlanValidation } from "../../../work/plans/plan-validate.js";
import { pgPlanStore } from "../../../outbound/plans/plan-store-pg.js";
import {
  planValidateDepsFor,
  projectionOf,
  resumeDepsFor,
  specReworkDepsFor,
  specWorkDepsFor,
  type PlanValidateRouteDeps,
  type SpecReworkRouteDeps,
} from "./plan-line-deps.js";
import { bearerScope } from "../../http/bearer-scope.js";
import { zodResponse } from "../../http/zod-response.js";
import { zodValidate } from "../../http/zod-validate.js";
import { withPool } from "../with-pool.js";

const BASE = "/api/repos/{owner}/{repo}/plans/{id}";

export interface PlanLifecyclePorts {
  service: PlanApprover & { reopenPlan(planId: string): Promise<PlanMeta> };
  getPool: () => Pool | null;
  /** The rework's deps per repo; the production wiring reads the PR through the repo's GitHub App, a test hands in doubles. */
  specReworkDeps?: (repo: string, pool: Pool) => Promise<SpecReworkRouteDeps>;
  /** The validator's deps per repo; a test hands in doubles. */
  planValidateDeps?: (
    repo: string,
    pool: Pool,
  ) => Promise<PlanValidateRouteDeps>;
}

export function planLifecycleRoutes(ports: PlanLifecyclePorts): ServerRoute[] {
  const { service, getPool } = ports;

  return [
    lifecycleRoute(getPool, "approve", APPROVE_OPTIONS, (pool, request, h) =>
      serveApprove(service, pool, request, h),
    ),
    lifecycleRoute(getPool, "reopen", REOPEN_OPTIONS, (pool, request, h) =>
      serveReopen(service, pool, request, h),
    ),
    lifecycleRoute(getPool, "spec-work", SPEC_WORK_OPTIONS, serveSpecWork),
    specReworkRoute(getPool, ports.specReworkDeps ?? specReworkDepsFor),
    validateRoute(getPool, ports.planValidateDeps ?? planValidateDepsFor),
    lifecycleRoute(
      getPool,
      "author-waiting",
      AUTHOR_WAITING_OPTIONS,
      (pool, request, h) => serveAuthorWaiting(service, pool, request, h),
    ),
  ];
}

type Serve = (
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
) => Promise<ResponseObject>;

function lifecycleRoute(
  getPool: PlanLifecyclePorts["getPool"],
  path: string,
  options: ServerRoute["options"],
  serve: Serve,
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

const NOT_APPROVED = "the plan is not approved";

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
  service: PlanLifecyclePorts["service"],
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
) {
  const plan = await repoPlan(() => pool, request);
  const reopened = await openForAuthor(
    resumeDepsFor(plan.repo, pool).runs,
    plan,
    (planId) => service.reopenPlan(planId),
  );

  return h.response({ reopened });
}

async function serveApprove(
  service: PlanApprover,
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
) {
  const plan = await repoPlan(() => pool, request);
  const { approvedBy } = request.payload as z.infer<typeof ApproveBody>;
  const decision = await decideApproval(
    resumeDepsFor(plan.repo, pool).runs,
    plan.id,
  );

  enforceTrue(
    decision.kind !== "refused",
    apiError(409),
    decision.kind === "refused" ? decision.reason : "",
  );

  return h.response(await approveOrRefuse(service, plan.id, approvedBy));
}

async function serveReopen(
  service: PlanLifecyclePorts["service"],
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
) {
  const plan = await repoPlan(() => pool, request);
  const { reopenedBy } = request.payload as z.infer<typeof ReopenBody>;

  enforceTrue(plan.status === "approved", apiError(409), NOT_APPROVED);
  await reopenPlan(resumeDepsFor(plan.repo, pool), plan.id, reopenedBy);

  return h.response(await service.reopenPlan(plan.id));
}

async function serveSpecWork(pool: Pool, request: Request, h: ResponseToolkit) {
  const plan = await repoPlan(() => pool, request);
  const { createdBy } = request.payload as z.infer<typeof SpecWorkBody>;
  const deps = specWorkDepsFor(plan.repo, pool);
  const line = await planLineState(deps.runs, plan.id);

  enforceTrue(plan.status === "approved", apiError(409), NOT_APPROVED);
  enforceTrue(
    !line || line.open === null,
    apiError(409),
    "the spec work is already running",
  );
  const projection = await projectionOf(() => pool, plan.id);
  const taskId = await startSpecWork(deps, {
    plan,
    projection,
    createdBy,
    line,
  });

  return h.response({ task_id: taskId }).code(202);
}

function specReworkRoute(
  getPool: PlanLifecyclePorts["getPool"],
  depsFor: NonNullable<PlanLifecyclePorts["specReworkDeps"]>,
): ServerRoute {
  return lifecycleRoute(
    getPool,
    "spec-rework",
    SPEC_REWORK_OPTIONS,
    (pool, request, h) => serveSpecRework(depsFor, pool, request, h),
  );
}

async function serveSpecRework(
  depsFor: NonNullable<PlanLifecyclePorts["specReworkDeps"]>,
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
) {
  const plan = await repoPlan(() => pool, request);
  const { actor } = request.payload as z.infer<typeof SpecReworkBody>;
  const deps = await depsFor(plan.repo, pool);
  const line = await planLineState(deps.line, plan.id);

  enforceTrue(
    line !== null,
    apiError(409),
    "the spec PR is not waiting for review",
  );
  const runId = await startSpecRework(deps, { plan, line, actor });

  return h.response({ run_id: runId }).code(202);
}

function validateRoute(
  getPool: PlanLifecyclePorts["getPool"],
  depsFor: NonNullable<PlanLifecyclePorts["planValidateDeps"]>,
): ServerRoute {
  return lifecycleRoute(
    getPool,
    "validate",
    VALIDATE_OPTIONS,
    (pool, request, h) => serveValidate(depsFor, pool, request, h),
  );
}

async function serveValidate(
  depsFor: NonNullable<PlanLifecyclePorts["planValidateDeps"]>,
  pool: Pool,
  request: Request,
  h: ResponseToolkit,
) {
  const plan = await repoPlan(() => pool, request);
  const { actor } = request.payload as z.infer<typeof PlanValidateBody>;
  const deps = await depsFor(plan.repo, pool);
  const line = await planLineState(deps.line, plan.id);
  const result = await startPlanValidation(deps, { plan, line, actor });

  return h.response(result).code(202);
}

// The plan the path names, only when it belongs to the path's repo.
async function repoPlan(db: () => Pool, request: Request): Promise<PlanMeta> {
  const meta = await pgPlanStore(db).getMeta(String(request.params.id));
  const repo = `${request.params.owner}/${request.params.repo}`;

  enforceTrue(meta?.repo === repo, apiError(404), "plan not found");

  return meta;
}
