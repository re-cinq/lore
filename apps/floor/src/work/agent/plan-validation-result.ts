// The plan validator's findings, delivered where they belong: the plan, for its people to see (specs/7-feature-planning). The pod holds no API token, so the Floor carries the write.

import type { AssemblyRunsPort } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { djb2Hash } from "@re-cinq/lore-shared/llm/prompt-cache.js";
import {
  PLAN_VALIDATION_RESULT_EVENT,
  planValidationResultSchema,
  type PlanValidationResult,
} from "@re-cinq/lore-shared/review/plan-validation.js";
import type { PlanFinding, PlanWriter } from "../../domain/plan-writer.js";
import type { AgentFileEvent } from "./agent-events.js";
import { openRunOfTask } from "./spec-review-result.js";

/** Who the plan's people see the findings from. */
export const PLAN_VALIDATOR_ACTOR = "plan-validator";

export interface PlanValidationResultDeps {
  assemblyRuns: Pick<AssemblyRunsPort, "listForTask">;
  plans: Pick<PlanWriter, "addQuestions" | "findingsOf">;
}

type Finding = PlanValidationResult["findings"][number];

interface AddFindingOp {
  op: "add-finding";
  slot: string;
  findingId: string;
  text: string;
  why: string;
  severity: Finding["severity"];
}

interface RemoveBlockOp {
  op: "remove-block";
  slot: string;
  blockId: string;
}

/** The validator's findings from the sink, reconciled onto the plan it validated. Not this handler's event, or no answer, or no open run with a plan, or nothing to change: a no-op. */
export async function deliverPlanValidation(
  fileEvent: AgentFileEvent,
  deps: PlanValidationResultDeps,
): Promise<void> {
  const content = answeredContent(fileEvent);

  if (content === undefined) {
    return;
  }
  const planId = await planIdOfTask(fileEvent.taskId, deps.assemblyRuns);

  if (planId === undefined) {
    return;
  }
  const findings = parsedFindings(content);
  const ops = findings
    ? reconciledOps(findings, await deps.plans.findingsOf(planId))
    : [];

  if (ops.length === 0) {
    return;
  }
  await deps.plans.addQuestions(planId, { actor: PLAN_VALIDATOR_ACTOR, ops });
}

/** The validator's answer, when the event is this handler's and the pod answered. */
function answeredContent(fileEvent: AgentFileEvent): string | undefined {
  const isAnswer =
    fileEvent.event === PLAN_VALIDATION_RESULT_EVENT && !fileEvent.reason;

  return isAnswer ? (fileEvent.content ?? undefined) : undefined;
}

async function planIdOfTask(
  taskId: string,
  assemblyRuns: PlanValidationResultDeps["assemblyRuns"],
): Promise<string | undefined> {
  const planId = (await openRunOfTask(taskId, assemblyRuns))?.args.plan_id;

  return typeof planId === "string" ? planId : undefined;
}

function parsedFindings(content: string): Finding[] | undefined {
  const parsed = planValidationResultSchema.safeParse(JSON.parse(content));

  return parsed.success ? parsed.data.findings : undefined;
}

/** The pass's findings added, and every unresolved finding it did not report again removed: each pass replaces the plan's open findings. */
function reconciledOps(
  findings: Finding[],
  existing: PlanFinding[],
): Array<AddFindingOp | RemoveBlockOp> {
  const addOps = findings.map(addFindingOp);
  const reportedIds = new Set(addOps.map((op) => op.findingId));

  return [...addOps, ...staleFindingOps(existing, reportedIds)];
}

/** A resolved finding is its people's, never removed. */
function staleFindingOps(
  existing: PlanFinding[],
  reportedIds: Set<string>,
): RemoveBlockOp[] {
  return existing
    .filter(
      (finding) => !finding.resolved && !reportedIds.has(finding.findingId),
    )
    .map((finding) => ({
      op: "remove-block" as const,
      slot: finding.slot,
      blockId: finding.findingId,
    }));
}

function addFindingOp(finding: Finding): AddFindingOp {
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
