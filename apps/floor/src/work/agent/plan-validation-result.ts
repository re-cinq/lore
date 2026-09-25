// The plan validator's findings, delivered where they belong: the plan, for its people to see (specs/7-feature-planning). The pod holds no API token, so the Floor carries the write.

import type { AssemblyRunsPort } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { djb2Hash } from "@re-cinq/lore-shared/llm/prompt-cache.js";
import {
  PLAN_VALIDATION_RESULT_EVENT,
  planValidationResultSchema,
  type PlanValidationResult,
} from "@re-cinq/lore-shared/review/plan-validation.js";
import type { PlanWriter } from "../../domain/plan-writer.js";
import type { AgentFileEvent } from "./agent-events.js";
import { openRunOfTask } from "./spec-review-result.js";

/** Who the plan's people see the findings from. */
export const PLAN_VALIDATOR_ACTOR = "plan-validator";

export interface PlanValidationResultDeps {
  assemblyRuns: Pick<AssemblyRunsPort, "listForTask">;
  plans: Pick<PlanWriter, "addQuestions">;
}

type Finding = PlanValidationResult["findings"][number];

/** The validator's findings from the sink, added to the plan it validated. Not this handler's event, or no answer, or no open run with a plan: a no-op. */
export async function deliverPlanValidation(
  fileEvent: AgentFileEvent,
  deps: PlanValidationResultDeps,
): Promise<void> {
  if (fileEvent.event !== PLAN_VALIDATION_RESULT_EVENT) {
    return;
  }
  if (fileEvent.reason || fileEvent.content === null) {
    return;
  }
  const run = await openRunOfTask(fileEvent.taskId, deps.assemblyRuns);
  const planId = run?.args.plan_id;

  if (typeof planId !== "string") {
    return;
  }
  const parsed = planValidationResultSchema.safeParse(
    JSON.parse(fileEvent.content),
  );

  if (!parsed.success || parsed.data.findings.length === 0) {
    return;
  }
  await deps.plans.addQuestions(planId, {
    actor: PLAN_VALIDATOR_ACTOR,
    ops: parsed.data.findings.map(addFindingOp),
  });
}

function addFindingOp(finding: Finding): Record<string, unknown> {
  return {
    op: "add-finding",
    slot: finding.slot,
    findingId: finding.finding_id ?? findingIdOf(finding),
    text: finding.text,
    why: finding.why,
    severity: finding.severity,
  };
}

function findingIdOf(finding: Finding): string {
  return `f-${djb2Hash(`${finding.slot}\n${finding.text}`)}`;
}
