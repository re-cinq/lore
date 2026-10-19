// A pass REPLACES the unresolved findings it owns, and only those: two producers write findings into one plan, and whoever reconciled the lot would delete the other's (specs/7-feature-planning FR-22).

import { djb2Hash } from "@re-cinq/lore-shared/llm/prompt-cache.js";
import { SPEC_FINDING_PREFIX } from "@re-cinq/lore-shared/feature-planning/spec-findings.js";
import type { PlanValidationResult } from "@re-cinq/lore-shared/review/plan-validation.js";

/** Every finding the plan-grounding station writes, so each producer reconciles its own. */
export const GROUND_PREFIX = "f-ground-";

export type Finding = PlanValidationResult["findings"][number];

export interface PlanFinding {
  findingId: string;
  resolved: boolean;
}

export interface PlanSections {
  sections: { slot: string; findings: PlanFinding[] }[];
}

export type FindingOp =
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

/** Which unresolved findings a producer may remove. */
export type Owns = (findingId: string) => boolean;

export const groundOwned: Owns = (findingId) =>
  findingId.startsWith(GROUND_PREFIX);

/** The spec gate's findings: what a spec written from the plan could not uphold. */
export const specOwned: Owns = (findingId) =>
  findingId.startsWith(SPEC_FINDING_PREFIX);

export const validatorOwned: Owns = (findingId) =>
  !groundOwned(findingId) && !specOwned(findingId);

/** The pass's findings added, and every unresolved finding it owns and did not report again removed. A resolved finding is its people's, never removed. */
export function reconciledOps(
  findings: readonly Finding[],
  plan: PlanSections,
  owns: Owns,
): FindingOp[] {
  const addOps = findings.map(addFindingOp);
  const reported = new Set(addOps.map((op) => op.findingId));

  return [...addOps, ...staleOps(plan, reported, owns)];
}

function staleOps(
  plan: PlanSections,
  reported: Set<string>,
  owns: Owns,
): FindingOp[] {
  return plan.sections.flatMap(({ slot, findings }) =>
    findings
      .filter((finding) => !finding.resolved)
      .filter((finding) => owns(finding.findingId))
      .filter((finding) => !reported.has(finding.findingId))
      .map((finding) => ({
        op: "remove-block" as const,
        slot,
        blockId: finding.findingId,
      })),
  );
}

export function addFindingOp(
  finding: Finding,
): FindingOp & { findingId: string } {
  return {
    op: "add-finding",
    slot: finding.slot,
    findingId: finding.finding_id ?? findingIdOf(finding),
    text: finding.text,
    why: finding.why,
    severity: finding.severity,
  };
}

export function findingIdOf(finding: Pick<Finding, "slot" | "text">): string {
  return `f-${djb2Hash(`${finding.slot}\n${finding.text}`)}`;
}
