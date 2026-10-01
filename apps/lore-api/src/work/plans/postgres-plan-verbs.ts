import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { apiError } from "@re-cinq/lore-shared/http/api-error.js";
import {
  planLineState,
  type PlanningRunPort,
} from "@re-cinq/lore-shared/project/plans/plan-run.js";
import type { PlanView } from "./plan-briefs.js";
import type {
  PlanContentVerbs,
  PlanSubject,
  PlanVerbs,
} from "./plan-engine.js";
import { startPlanValidation, type PlanValidateDeps } from "./plan-validate.js";
import {
  NOT_APPROVED,
  SPEC_WORK_RUNNING,
  askRefine,
  decideApproval,
  handOverApproved,
  openForAuthor,
  reopenPlan,
  startDrafting,
  startSpecWork,
  type SpecWorkDeps,
} from "./planning-line.js";
import {
  SPEC_PR_NOT_WAITING,
  startSpecRework,
  type SpecReworkDeps,
} from "./spec-rework.js";

export interface PostgresPlanDeps {
  specWork: SpecWorkDeps;
  projection(planId: string): Promise<PlanView>;
  rework(): Promise<SpecReworkDeps & { line: PlanningRunPort }>;
  validate(): Promise<PlanValidateDeps & { line: PlanningRunPort }>;
}

/** The plan routes' verbs over the assembly runs Postgres holds: what planning-line.ts, spec-rework.ts and plan-validate.ts answer, each asked the way its route asked it before the floor existed. */
export function postgresPlanVerbs(deps: PostgresPlanDeps): PlanVerbs {
  return { ...projectionVerbs(deps), ...lineVerbs(deps) };
}

function projectionVerbs(deps: PostgresPlanDeps): PlanContentVerbs {
  const { specWork, projection } = deps;

  return {
    draft: async (plan, { known, createdBy }) =>
      startDrafting(specWork, {
        plan,
        projection: await projection(plan.id),
        known,
        createdBy,
      }),
    refine: async (plan, request) =>
      askRefine(specWork, plan.id, await projection(plan.id), request),
    handOverApproved: async (plan, approvedBy) =>
      handOverApproved(specWork, plan, await projection(plan.id), approvedBy),
    startSpecWork: (plan, createdBy) => specWorkOf(deps, plan, createdBy),
  };
}

function lineVerbs(
  deps: PostgresPlanDeps,
): Omit<PlanVerbs, keyof PlanContentVerbs> {
  const { runs } = deps.specWork;

  return {
    approvalDecision: (plan) => decideApproval(runs, plan.id),
    reopen: (plan, actor) => reopenPlan(deps.specWork, plan.id, actor),
    openForAuthor: (plan, reopen) => openForAuthor(runs, plan, reopen),
    reworkSpec: (plan, actor) => reworkOf(deps, plan, actor),
    validate: (plan, actor) => validateOf(deps, plan, actor),
  };
}

async function specWorkOf(
  deps: PostgresPlanDeps,
  plan: PlanSubject,
  createdBy: string,
): Promise<string> {
  const line = await planLineState(deps.specWork.runs, plan.id);

  enforceTrue(plan.status === "approved", apiError(409), NOT_APPROVED);
  enforceTrue(!line || line.open === null, apiError(409), SPEC_WORK_RUNNING);

  return startSpecWork(deps.specWork, {
    plan,
    projection: await deps.projection(plan.id),
    createdBy,
    line,
  });
}

async function reworkOf(
  deps: PostgresPlanDeps,
  plan: PlanSubject,
  actor: string,
): Promise<string> {
  const reworkDeps = await deps.rework();
  const line = await planLineState(reworkDeps.line, plan.id);

  enforceTrue(line !== null, apiError(409), SPEC_PR_NOT_WAITING);

  return startSpecRework(reworkDeps, { plan, line, actor });
}

async function validateOf(
  deps: PostgresPlanDeps,
  plan: PlanSubject,
  actor: string,
): Promise<string> {
  const validateDeps = await deps.validate();
  const line = await planLineState(validateDeps.line, plan.id);
  const started = await startPlanValidation(validateDeps, {
    plan,
    line,
    actor,
  });

  return started.run_id;
}
