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
});
