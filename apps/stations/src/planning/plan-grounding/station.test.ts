import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { GROUND_PREFIX, type PlanEdit } from "../plan-findings-ops.js";
import { planGroundingHandle, type PlanGroundingDeps } from "./station.js";

const PLAN_ID = "3b3a67af";
const TARGET = "https://github.com/re-cinq/lore@main";
const PLAN_MD = [
  "# Issue triage Assembly Line",
  "",
  "## Platform work this line needs <!-- slot:custom-platform-work -->",
  "",
  "Map it to this line (`assemblyLineFor` in `apps/floor/src/work/task/dispatch-agent-cr.ts`).",
  "",
].join("\n");

const NEEDS = { plan_id: PLAN_ID, target: TARGET, plan_md: "blob://plan" };

function scene(
  planMd: string | null = PLAN_MD,
  carried: { findingId: string; resolved: boolean }[] = [],
) {
  const edits: PlanEdit[] = [];
  const tools: Tools = {
    read: async () =>
      planMd === null
        ? Promise.reject(new Error("no plan_md in the bag"))
        : Buffer.from(planMd),
    produce: async () => {},
    modelCall: async () => {},
    signal: new AbortController().signal,
  };
  const deps: PlanGroundingDeps = {
    listTree: async () => [
      "libs/assembly-lines/src/floor-pipelines/onboard.yaml",
    ],
    readFile: async () => null,
    planOf: async () => ({
      sections: [{ slot: "custom-platform-work", findings: carried }],
    }),
    edit: async (edit) => {
      edits.push(edit);
    },
  };

  return { handle: planGroundingHandle(deps), tools, edits };
}

const brief = { visitId: "visit-ground", iteration: 1, needs: NEEDS };

describe("planGroundingHandle", () => {
  it("puts a blocker on the section naming a retired component and reports success", async () => {
    const { handle, tools, edits } = scene();

    const report = await handle(brief, tools);

    expect({ report, ops: edits[0]?.ops }).toMatchObject({
      report: { outcome: "success" },
      ops: [
        {
          op: "add-finding",
          slot: "custom-platform-work",
          severity: "blocker",
          text: expect.stringContaining("apps/floor"),
        },
      ],
    });
  });

  it("removes a grounding finding it no longer reports and leaves the validator's alone", async () => {
    const { handle, tools, edits } = scene(
      "## Clean <!-- slot:intent -->\n\nNothing stale.\n",
      [
        { findingId: `${GROUND_PREFIX}gone`, resolved: false },
        { findingId: "f-validator-open", resolved: false },
      ],
    );

    await handle(brief, tools);

    expect(edits[0]?.ops).toEqual([
      {
        op: "remove-block",
        slot: "custom-platform-work",
        blockId: `${GROUND_PREFIX}gone`,
      },
    ]);
  });

  it("writes nothing when the pass carries no plan_md to ground", async () => {
    const { handle, tools, edits } = scene(null);

    expect({ report: await handle(brief, tools), edits }).toEqual({
      report: { outcome: "success" },
      edits: [],
    });
  });
});
