// The plan validator's findings, delivered where they belong: the plan, for its people to see (specs/7-feature-planning FR-19). Every validate visit settles here: a pass REPLACES the plan's unresolved findings, and a visit that delivered nothing puts a blocker on the plan rather than leaving it looking clean.

import {
  defineStation,
  type Handle,
  type Report,
  type RunningStation,
  type Tools,
} from "@re-cinq/floor-station";
import { floorClient } from "@re-cinq/lore-shared/floor/floor-client.js";
import { djb2Hash } from "@re-cinq/lore-shared/llm/prompt-cache.js";
import {
  planValidationResultSchema,
  type PlanValidationResult,
} from "@re-cinq/lore-shared/review/plan-validation.js";
import { z } from "zod";
import { requestPlan } from "../plan-api.js";

/** Who the plan's people see the findings from. */
const PLAN_VALIDATOR_ACTOR = "plan-validator";

/** The one blocker a visit that delivered nothing leaves, replaced by the next pass that does deliver. */
export const MISSING_FINDING_ID = "f-validation-missing";

const NOT_DELIVERED =
  "the validator delivered no plan-validation.json; the plan was not validated";
const NOT_PARSED =
  "the validator's plan-validation.json does not parse; the plan was not validated";
const MISSING_TEXT =
  "Validation did not finish: the validator delivered no findings. Validate the plan again.";

type Finding = PlanValidationResult["findings"][number];

interface PlanFinding {
  findingId: string;
  resolved: boolean;
}

export interface PlanSections {
  sections: { slot: string; findings: PlanFinding[] }[];
}

type FindingOp =
  | {
      op: "add-finding";
      slot: string;
      findingId: string;
      text: string;
      why: string;
      severity: Finding["severity"];
    }
  | { op: "remove-block"; slot: string; blockId: string };

export interface PlanEdit {
  planId: string;
  ops: FindingOp[];
}

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
    await editWith(deps, planId, reconciledOps(findings, plan));

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

/** The pass's findings added, and every unresolved finding it did not report again removed. A resolved finding is its people's, never removed. */
function reconciledOps(findings: Finding[], plan: PlanSections): FindingOp[] {
  const addOps = findings.map(addFindingOp);
  const reported = new Set(addOps.map((op) => op.findingId));
  const staleOps = plan.sections.flatMap(({ slot, findings: existing }) =>
    existing
      .filter(
        (finding) => !finding.resolved && !reported.has(finding.findingId),
      )
      .map((finding) => ({
        op: "remove-block" as const,
        slot,
        blockId: finding.findingId,
      })),
  );

  return [...addOps, ...staleOps];
}

function addFindingOp(finding: Finding): FindingOp & { findingId: string } {
  return {
    op: "add-finding",
    slot: finding.slot,
    findingId:
      finding.finding_id ?? `f-${djb2Hash(`${finding.slot}\n${finding.text}`)}`,
    text: finding.text,
    why: finding.why,
    severity: finding.severity,
  };
}

// The plan projection lore-api serves at `GET /api/plans/{id}`,, read only as far as its sections and their finding blocks.
const planProjectionSchema = z.object({
  json: z.object({
    sections: z.array(
      z.object({
        slot: z.string(),
        blocks: z.array(
          z.object({
            type: z.string(),
            props: z.record(z.string(), z.unknown()).default({}),
          }),
        ),
      }),
    ),
  }),
});

function sectionsOf(projection: unknown): PlanSections {
  const { sections } = planProjectionSchema.parse(projection).json;

  return {
    sections: sections.map(({ slot, blocks }) => ({
      slot,
      findings: blocks
        .filter((block) => block.type === "finding")
        .map(({ props }) => ({
          findingId: String(props.findingId),
          resolved: props.resolved === true,
        })),
    })),
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

const productionDeps: PlanFindingsDeps = {
  validateDelivered: latestValidateDelivered,
  planOf: async (planId) =>
    sectionsOf(await (await requestPlan(planId, { method: "GET" })).json()),
  edit: async ({ planId, ops }) => {
    await requestPlan(`${planId}/agent-edits`, {
      method: "POST",
      body: { actor: PLAN_VALIDATOR_ACTOR, ops },
    });
  },
};

export function startPlanFindingsStation(): RunningStation {
  return defineStation("plan-findings", planFindingsHandle(productionDeps));
}
