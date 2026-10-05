import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import {
  MISSING_FINDING_ID,
  planFindingsHandle,
  type PlanFindingsDeps,
  type PlanEdit,
} from "./station.js";

const PLAN_ID = "3b3a67af-1111-4a35-9d1f-8f6f0a2f4e21";

function toolsReading(content: string): Tools {
  return {
    read: () => Promise.resolve(Buffer.from(content)),
    produce: () => Promise.resolve(),
    modelCall: () => Promise.resolve(),
    signal: new AbortController().signal,
  };
}

function brief() {
  return {
    visitId: "visit-findings",
    iteration: 1,
    needs: { plan_id: PLAN_ID, plan_validation: "blob://validation" },
  };
}

interface Scene {
  produced: boolean;
  plan?: Awaited<ReturnType<PlanFindingsDeps["planOf"]>>;
}

const PLAN = {
  sections: [
    { slot: "problem", findings: [] },
    {
      slot: "scope",
      findings: [
        { findingId: "f-old", resolved: false },
        { findingId: "f-kept", resolved: true },
      ],
    },
  ],
};

function scene({ produced, plan = PLAN }: Scene) {
  const edits: PlanEdit[] = [];
  const deps: PlanFindingsDeps = {
    validateDelivered: () => Promise.resolve(produced),
    planOf: () => Promise.resolve(plan),
    edit: async (edit) => {
      edits.push(edit);
    },
  };

  return { handle: planFindingsHandle(deps), edits };
}

const ONE_FINDING = JSON.stringify({
  findings: [
    {
      slot: "scope",
      text: "The plan names no label text.",
      why: "Section scope promises a label",
      severity: "blocker",
      finding_id: "f-label",
    },
  ],
});

describe("planFindingsHandle", () => {
  it("adds each reported finding and removes the unresolved ones the pass no longer reports, keeping resolved ones", async () => {
    const { handle, edits } = scene({ produced: true });

    expect(await handle(brief(), toolsReading(ONE_FINDING))).toEqual({
      outcome: "success",
    });
    expect(edits).toEqual([
      {
        planId: PLAN_ID,
        ops: [
          {
            op: "add-finding",
            slot: "scope",
            findingId: "f-label",
            text: "The plan names no label text.",
            why: "Section scope promises a label",
            severity: "blocker",
          },
          { op: "remove-block", slot: "scope", blockId: "f-old" },
        ],
      },
    ]);
  });

  it("keys a finding the validator gave no id on its section and text, the same on every pass", async () => {
    const unkeyed = JSON.stringify({
      findings: [{ slot: "problem", text: "No KPI source." }],
    });
    const first = scene({ produced: true, plan: { sections: [] } });
    const second = scene({ produced: true, plan: { sections: [] } });

    await first.handle(brief(), toolsReading(unkeyed));
    await second.handle(brief(), toolsReading(unkeyed));

    expect(first.edits).toEqual(second.edits);
    expect(first.edits[0]?.ops).toEqual([
      {
        op: "add-finding",
        slot: "problem",
        findingId: expect.stringMatching(/^f-\w+$/),
        text: "No KPI source.",
        why: "",
        severity: "warning",
      },
    ]);
  });

  it("clears every unresolved finding when the validator reports the plan clean", async () => {
    const { handle, edits } = scene({ produced: true });

    await handle(brief(), toolsReading('{"findings": []}'));

    expect(edits).toEqual([
      {
        planId: PLAN_ID,
        ops: [{ op: "remove-block", slot: "scope", blockId: "f-old" }],
      },
    ]);
  });

  it("fails and puts a fresh, unresolved blocker on the plan's first section when the validate visit delivered no findings file", async () => {
    const { handle, edits } = scene({ produced: false });

    expect(await handle(brief(), toolsReading(ONE_FINDING))).toEqual({
      outcome: "failed",
      error:
        "the validator delivered no plan-validation.json; the plan was not validated",
    });
    expect(edits).toEqual([
      {
        planId: PLAN_ID,
        ops: [
          { op: "remove-block", slot: "problem", blockId: MISSING_FINDING_ID },
          {
            op: "add-finding",
            slot: "problem",
            findingId: MISSING_FINDING_ID,
            text: "Validation did not finish: the validator delivered no findings. Validate the plan again.",
            why: "the validator delivered no plan-validation.json; the plan was not validated",
            severity: "blocker",
          },
        ],
      },
    ]);
  });

  it("fails with a blocker when the findings file is not the validator's shape", async () => {
    const { handle, edits } = scene({ produced: true });

    expect(await handle(brief(), toolsReading("{not json"))).toEqual({
      outcome: "failed",
      error:
        "the validator's plan-validation.json does not parse; the plan was not validated",
    });
    expect(edits[0]?.ops).toEqual([
      expect.objectContaining({ op: "remove-block" }),
      expect.objectContaining({
        findingId: MISSING_FINDING_ID,
        severity: "blocker",
      }),
    ]);
  });

  it("fails with a blocker naming the read error when the findings file cannot be read", async () => {
    const { handle } = scene({ produced: true });
    const unreadable: Tools = {
      ...toolsReading(""),
      read: () => Promise.reject(new Error("floor answered 503")),
    };

    expect(await handle(brief(), unreadable)).toEqual({
      outcome: "failed",
      error:
        "the validator's plan-validation.json could not be read (floor answered 503); the plan was not validated",
    });
  });

  it("fails without editing when the plan has no section to carry the blocker", async () => {
    const { handle, edits } = scene({
      produced: false,
      plan: { sections: [] },
    });

    expect(await handle(brief(), toolsReading(""))).toEqual({
      outcome: "failed",
      error:
        "the validator delivered no plan-validation.json; the plan was not validated",
    });
    expect(edits).toEqual([]);
  });
});
