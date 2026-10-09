// What a spec gate that gave up leaves on the plan: one blocker finding per check the spec could not uphold, in the section the check is about, so the plan's people fix the plan rather than reading a spec that disagrees with it (specs/7-feature-planning/spec.md FR-24).

import { djb2Hash } from "../../lib/djb2.js";
import type { QaFailure } from "./spec-qa.js";

/** A finding as the plan carries it (the shape of `plan-validation.json`'s entries): the section it is about, the text its people read, why, and its severity. */
export interface PlanFinding {
  slot: string;
  text: string;
  why: string;
  severity: "blocker" | "warning";
  finding_id: string;
}

/** Every finding the spec gate writes, so it reconciles its own and no other producer's. */
export const SPEC_FINDING_PREFIX = "f-spec-";

/** The repair visit's mark: a gap no section owns lands on the intent, the section every reader opens first. */
const REPAIR_SLOT = "*";
const INTENT_SLOT = "intent";

export function specFindingsOf(
  failures: readonly QaFailure[],
  rounds: number,
): PlanFinding[] {
  return failures.map((failure) => findingOf(failure, rounds));
}

function findingOf(failure: QaFailure, rounds: number): PlanFinding {
  const slot = failure.section === REPAIR_SLOT ? INTENT_SLOT : failure.section;
  const text = `${failure.text} — the spec written from this plan could not uphold it: ${failure.reason}`;

  return {
    slot,
    text,
    why: `After ${rounds} rounds the spec and this section still disagree. Fix the section, or the plan where it contradicts itself, then approve again.`,
    severity: "blocker",
    finding_id: `${SPEC_FINDING_PREFIX}${djb2Hash(`${slot}\n${text}`)}`,
  };
}
