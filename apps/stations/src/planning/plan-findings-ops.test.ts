import { describe, expect, it } from "vitest";
import { SPEC_FINDING_PREFIX } from "@re-cinq/lore-shared/feature-planning/spec-findings.js";
import {
  GROUND_PREFIX,
  groundOwned,
  reconciledOps,
  specOwned,
  validatorOwned,
  type PlanSections,
} from "./plan-findings-ops.js";

const PLAN: PlanSections = {
  sections: [
    {
      slot: "intent",
      findings: [
        { findingId: "f-validator-stale", resolved: false },
        { findingId: "f-validator-settled", resolved: true },
        { findingId: `${GROUND_PREFIX}stale`, resolved: false },
        { findingId: `${GROUND_PREFIX}settled`, resolved: true },
        { findingId: `${SPEC_FINDING_PREFIX}stale`, resolved: false },
      ],
    },
  ],
};

const REPORTED = [
  {
    slot: "intent",
    text: "apps/floor was deleted",
    why: "nothing on main has that path",
    severity: "blocker" as const,
  },
];

function removed(ops: ReturnType<typeof reconciledOps>): string[] {
  return ops
    .filter((op) => op.op === "remove-block")
    .map((op) => (op.op === "remove-block" ? op.blockId : ""));
}

describe("reconciledOps", () => {
  it("removes the validator's stale finding and leaves every grounding and spec-gate finding when the validator reports", () => {
    expect(removed(reconciledOps(REPORTED, PLAN, validatorOwned))).toEqual([
      "f-validator-stale",
    ]);
  });

  it("removes the grounding station's stale finding and leaves every validator finding when grounding reports", () => {
    expect(removed(reconciledOps(REPORTED, PLAN, groundOwned))).toEqual([
      `${GROUND_PREFIX}stale`,
    ]);
  });

  it("removes the spec gate's stale finding and leaves the validator's and grounding's when the spec gate reports", () => {
    expect(removed(reconciledOps(REPORTED, PLAN, specOwned))).toEqual([
      `${SPEC_FINDING_PREFIX}stale`,
    ]);
  });

  it("never removes a finding the pass reported again, whoever owns it", () => {
    const ops = reconciledOps(
      [{ ...REPORTED[0]!, finding_id: `${GROUND_PREFIX}stale` }],
      PLAN,
      groundOwned,
    );

    expect(removed(ops)).toEqual([]);
  });
});
