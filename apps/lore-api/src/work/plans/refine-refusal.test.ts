import { describe, it, expect } from "vitest";
import { agentHasThePlan, approvedRefineRefusal } from "./refine-refusal.js";

const openOn = (open: string) => ({ status: "open", outcome: null, open });

describe("agentHasThePlan", () => {
  it("is true on every node of a drafting pass and false on the spec work and on no line", () => {
    expect({
      drafting: ["analyze", "plan-pass-end", "validate", "plan-findings"].map(
        (node) => agentHasThePlan(openOn(node)),
      ),
      specWork: ["write", "merged", "decompose"].map((node) =>
        agentHasThePlan(openOn(node)),
      ),
      noLine: agentHasThePlan(null),
    }).toEqual({
      drafting: [true, true, true, true],
      specWork: [false, false, false],
      noLine: false,
    });
  });
});

describe("approvedRefineRefusal", () => {
  it("tells an approved plan to reopen while the specs are being written, since reopening now stops that work", () => {
    expect(
      ["write", "decompose"].map((node) => approvedRefineRefusal(openOn(node))),
    ).toEqual([
      "the plan is approved, so its sections are settled; reopen the plan to write again",
      "the plan is approved, so its sections are settled; reopen the plan to write again",
    ]);
  });
});
