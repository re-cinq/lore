import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import type { PlanEdit } from "../plan-findings-ops.js";
import { specFindingsHandle, type SpecFindingsDeps } from "./station.js";

const PLAN_ID = "3b3a67af-1111-4a35-9d1f-8f6f0a2f4e21";

const VERDICT = JSON.stringify({
  rounds: 3,
  failures: [
    {
      id: "q1",
      section: "scope",
      text: "Billing is out of scope.",
      reason: "The spec puts billing in scope.",
    },
  ],
});

const PLAN = {
  sections: [
    { slot: "intent", findings: [] },
    {
      slot: "scope",
      findings: [
        { findingId: "f-spec-old", resolved: false },
        { findingId: "f-spec-kept", resolved: true },
        { findingId: "f-validator", resolved: false },
        { findingId: "f-ground-name", resolved: false },
      ],
    },
  ],
};

function toolsReading(content: string): Tools {
  return {
    read: () => Promise.resolve(Buffer.from(content)),
    produce: () => Promise.resolve(),
    modelCall: () => Promise.resolve(),
    signal: new AbortController().signal,
  };
}

const brief = {
  visitId: "visit-spec-findings",
  iteration: 1,
  needs: { plan_id: PLAN_ID, qa_verdict: "blob://verdict" },
};

function scene() {
  const edits: PlanEdit[] = [];
  const deps: SpecFindingsDeps = {
    planOf: () => Promise.resolve(PLAN),
    edit: async (edit) => {
      edits.push(edit);
    },
  };

  return { handle: specFindingsHandle(deps), edits };
}

function sceneRefusingEdits() {
  const deps: SpecFindingsDeps = {
    planOf: () => Promise.resolve(PLAN),
    edit: () => Promise.reject(new Error("the plan is being written")),
  };

  return { handle: specFindingsHandle(deps) };
}

describe("specFindingsHandle", () => {
  it("writes the checks the spec could not uphold into the plan as blocker findings on their sections, replacing its own earlier ones and leaving the validator's and grounding's alone", async () => {
    const { handle, edits } = scene();

    const report = await handle(brief, toolsReading(VERDICT));

    expect({ report, edits }).toEqual({
      report: { outcome: "success" },
      edits: [
        {
          planId: PLAN_ID,
          ops: [
            {
              op: "add-finding",
              slot: "scope",
              findingId: expect.stringMatching(/^f-spec-\w+$/),
              text: "Billing is out of scope. — the spec written from this plan could not uphold it: The spec puts billing in scope.",
              why: "After 3 rounds the spec and this section still disagree. Fix the section, or the plan where it contradicts itself, then approve again.",
              severity: "blocker",
            },
            { op: "remove-block", slot: "scope", blockId: "f-spec-old" },
          ],
        },
      ],
    });
  });

  it("reports failed, naming why, when the plan cannot be edited", async () => {
    const { handle } = sceneRefusingEdits();

    expect(await handle(brief, toolsReading(VERDICT))).toEqual({
      outcome: "failed",
      error: "the plan is being written",
    });
  });

  it("reports failed when the verdict is not one", async () => {
    const { handle, edits } = scene();

    const report = await handle(brief, toolsReading("{oops"));

    expect({ outcome: report.outcome, edits }).toEqual({
      outcome: "failed",
      edits: [],
    });
  });
});
