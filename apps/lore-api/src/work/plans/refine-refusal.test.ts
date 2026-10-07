import { describe, it, expect } from "vitest";
import { refineRefusal } from "./refine-refusal.js";

const openOn = (open: string) => ({
  status: "open",
  outcome: null,
  open,
  merged: false,
  parkedMerged: null,
});

describe("refineRefusal", () => {
  it("says the agent is still working while validate or plan-findings has the draft", () => {
    expect(
      ["validate", "plan-findings"].map((node) =>
        refineRefusal({ status: "draft" }, openOn(node)),
      ),
    ).toEqual([
      "the planning agent is still working on this plan",
      "the planning agent is still working on this plan",
    ]);
  });

  it("tells an approved plan to reopen while the specs are being written, since reopening now stops that work", () => {
    expect(
      ["write", "decompose"].map((node) =>
        refineRefusal({ status: "approved" }, openOn(node)),
      ),
    ).toEqual([
      "the plan is approved, so its sections are settled; reopen the plan to write again",
      "the plan is approved, so its sections are settled; reopen the plan to write again",
    ]);
  });
});
