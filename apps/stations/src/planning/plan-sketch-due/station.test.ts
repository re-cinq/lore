import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import type { PlanBlockTypes } from "../plan-editor.js";
import { planSketchDueHandle } from "./station.js";

const PLAN_ID = "3b3a67af";

const TOOLS: Tools = {
  read: async () => Promise.reject(new Error("the bag is never read")),
  produce: async () => {},
  modelCall: async () => {},
  signal: new AbortController().signal,
};

const brief = {
  visitId: "visit-sketch-due",
  iteration: 1,
  needs: { plan_id: PLAN_ID },
};

function handleOver(sections: PlanBlockTypes) {
  return planSketchDueHandle({ blockTypesOf: async () => sections });
}

describe("planSketchDueHandle", () => {
  it("sends a plan with an empty Prototype section to the sketch agent", async () => {
    const handle = handleOver([
      { slot: "intent", blockTypes: ["paragraph"] },
      { slot: "prototype", blockTypes: [] },
    ]);

    expect(await handle(brief, TOOLS)).toEqual({
      outcome: "changes_requested",
    });
  });

  it("skips the sketch agent for a plan that holds sketch m-flow-1", async () => {
    const handle = handleOver([
      { slot: "prototype", blockTypes: ["paragraph", "mockup"] },
    ]);

    expect(await handle(brief, TOOLS)).toEqual({ outcome: "success" });
  });

  it("skips the sketch agent for a plan that dropped its Prototype section", async () => {
    const handle = handleOver([{ slot: "intent", blockTypes: ["paragraph"] }]);

    expect(await handle(brief, TOOLS)).toEqual({ outcome: "success" });
  });
});

describe("planSketchDueHandle for a plan nobody wrote yet", () => {
  it("skips the sketch agent for a plan whose sections hold no writing", async () => {
    const handle = handleOver([
      { slot: "intent", blockTypes: ["section-panel", "section-actions"] },
      { slot: "prototype", blockTypes: [] },
    ]);

    expect(await handle(brief, TOOLS)).toEqual({ outcome: "success" });
  });
});
