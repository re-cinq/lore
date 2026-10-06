// The plan validator's findings, delivered where they belong: the plan, for its people to see (specs/7-feature-planning FR-19). Every validate visit settles here: a pass REPLACES the plan's unresolved findings, and a visit that delivered nothing puts a blocker on the plan rather than leaving it looking clean.

import {
  defineStation,
  type Handle,
  type Report,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import { planValidationResultSchema } from "@re-cinq/lore-shared/review/plan-validation.js";
import { planEditorAs } from "../plan-editor.js";
import {
  reconciledOps,
  validatorOwned,
  type Finding,
  type FindingOp,
  type PlanEdit,
  type PlanSections,
} from "../plan-findings-ops.js";

/** The one blocker a visit that delivered nothing leaves, replaced by the next pass that does deliver. */
export const MISSING_FINDING_ID = "f-validation-missing";

const NOT_DELIVERED =
  "the validator delivered no plan-validation.json; the plan was not validated";
const NOT_PARSED =
  "the validator's plan-validation.json does not parse; the plan was not validated";
const MISSING_TEXT =
  "Validation did not finish: the validator delivered no findings. Validate the plan again.";

export interface PlanFindingsDeps {
  /** Whether the latest `validate` visit of this visit's run produced its findings file: the bag still holds an earlier visit's file when this one wrote nothing. */
  validateDelivered(visitId: string): Promise<boolean>;
  planOf(planId: string): Promise<PlanSections>;
  edit(edit: PlanEdit): Promise<void>;
}

export function planFindingsHandle(deps: PlanFindingsDeps): Handle {
  return async (brief, tools) => {
    const planId = brief.needs.plan_id;
    const findings = (await deps.validateDelivered(brief.visitId))
      ? await findingsRead(tools)
      : NOT_DELIVERED;
    const plan = await deps.planOf(planId);

    if (typeof findings === "string") {
      return blockApproval(deps, { planId, plan, reason: findings });
    }
    await editWith(deps, planId, reconciledOps(findings, plan, validatorOwned));

    return { outcome: "success" };
  };
}

/** The findings the visit delivered, or why they cannot be read. */
async function findingsRead(tools: Tools): Promise<Finding[] | string> {
  let content: string;

  try {
    content = (await tools.read("plan_validation")).toString("utf8");
  } catch (error) {
    return `the validator's plan-validation.json could not be read (${(error as Error).message}); the plan was not validated`;
  }

  return findingsParsed(content);
}

function findingsParsed(content: string): Finding[] | string {
  try {
    return planValidationResultSchema.parse(JSON.parse(content)).findings;
  } catch {
    return NOT_PARSED;
  }
}

interface Undelivered {
  planId: string;
  plan: PlanSections;
  reason: string;
}

/** A visit that delivered nothing leaves one blocker on the plan's first section, so Approve refuses until a pass that delivers replaces it. */
async function blockApproval(
  deps: PlanFindingsDeps,
  { planId, plan, reason }: Undelivered,
): Promise<Report> {
  const first = plan.sections.at(0);

  if (first) {
    await editWith(deps, planId, missingFindingOps(first.slot, reason));
  }

  return { outcome: "failed", error: reason };
}

async function editWith(
  deps: PlanFindingsDeps,
  planId: string,
  ops: FindingOp[],
): Promise<void> {
  if (ops.length > 0) {
    await deps.edit({ planId, ops });
  }
}

/** Removed first: re-adding a finding keeps the resolution people gave it, and a blocker someone resolved would no longer block. */
function missingFindingOps(slot: string, reason: string): FindingOp[] {
  return [
    { op: "remove-block", slot, blockId: MISSING_FINDING_ID },
    missingFindingOp(slot, reason),
  ];
}

function missingFindingOp(slot: string, reason: string): FindingOp {
  return {
    op: "add-finding",
    slot,
    findingId: MISSING_FINDING_ID,
    text: MISSING_TEXT,
    why: reason,
    severity: "blocker",
  };
}

async function latestValidateDelivered(visitId: string): Promise<boolean> {
  const runId = (await floorClient().stationRuns.get(visitId))?.runId;
  const visits = runId
    ? await floorClient().stationRuns.list({ run: runId, node: "validate" })
    : [];

  const last = visits.at(-1);
  const produced = last?.report?.produced ?? {};

  return "plan_validation" in produced;
}

/** Who the plan's people see the findings from. */
const PLAN_VALIDATOR_ACTOR = "plan-validator";

const productionDeps: PlanFindingsDeps = {
  validateDelivered: latestValidateDelivered,
  ...planEditorAs(PLAN_VALIDATOR_ACTOR),
};

export function startPlanFindingsStation(): RunningStation {
  return defineStation("plan-findings", planFindingsHandle(productionDeps));
}
