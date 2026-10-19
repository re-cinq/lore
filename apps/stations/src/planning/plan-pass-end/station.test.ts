import { describe, expect, it } from "vitest";
import type { Tools } from "@re-cinq/floor-station";
import { planPassEndHandle, type PlanPassEndDeps } from "./station.js";

const PLAN_ID = "3b3a67af-1111-4a35-9d1f-8f6f0a2f4e21";

const TOOLS: Tools = {
  read: () => Promise.resolve(Buffer.from("")),
  produce: () => Promise.resolve(),
  modelCall: () => Promise.resolve(),
  signal: new AbortController().signal,
};

const brief = {
  visitId: "visit-pass-end",
  iteration: 1,
  needs: { plan_id: PLAN_ID },
};

interface PassEnded {
  planId: string;
  outcome: string;
  reason?: string;
}

function scene(
  runId: string | null,
  visits: { nodeId: string; report: { outcome: string } | null }[],
  fails?: Error,
) {
  const ended: PassEnded[] = [];
  const deps: PlanPassEndDeps = {
    runOf: () => Promise.resolve(runId),
    visitsOf: () => Promise.resolve(visits),
    passEnded: async (input) => {
      ended.push(input);

      if (fails) {
        throw fails;
      }
    },
  };

  return { handle: planPassEndHandle(deps), ended };
}

describe("planPassEndHandle", () => {
  it("posts success for the plan when the analyze pass it settles succeeded", async () => {
    const { handle, ended } = scene("run-1", [
      { nodeId: "analyze", report: { outcome: "success" } },
    ]);

    expect({ report: await handle(brief, TOOLS), ended }).toEqual({
      report: { outcome: "success" },
      ended: [{ planId: PLAN_ID, outcome: "success" }],
    });
  });

  it("posts the outcome and why the pass stopped when the analyze pass failed", async () => {
    const { handle, ended } = scene("run-1", [
      { nodeId: "analyze", report: { outcome: "failed" } },
    ]);

    expect({ report: await handle(brief, TOOLS), ended }).toEqual({
      report: { outcome: "success" },
      ended: [
        {
          planId: PLAN_ID,
          outcome: "failed",
          reason:
            "the planning agent stopped with outcome failed before it answered",
        },
      ],
    });
  });

  it("posts for a pass nobody asked about, since lore-api holds the ask and decides whether a section waits", async () => {
    const { handle, ended } = scene("run-1", [
      { nodeId: "analyze", report: { outcome: "success" } },
      { nodeId: "author", report: null },
    ]);

    await handle(brief, TOOLS);

    expect(ended).toHaveLength(1);
  });

  it("speaks for the LATEST analyze visit, since earlier iterations each left one", async () => {
    const { handle, ended } = scene("run-1", [
      { nodeId: "analyze", report: { outcome: "success" } },
      { nodeId: "analyze", report: { outcome: "changes_requested" } },
    ]);

    await handle(brief, TOOLS);

    expect(ended.at(0)?.outcome).toBe("changes_requested");
  });

  it("posts a missing outcome when the floor names no run for this visit, so the section is told rather than left waiting", async () => {
    const { handle, ended } = scene(null, []);

    await handle(brief, TOOLS);

    expect(ended.at(0)).toMatchObject({ outcome: "missing" });
  });

  it("reports failed with the error message when the post itself fails, since the section would show nothing", async () => {
    const { handle } = scene(
      "run-1",
      [{ nodeId: "analyze", report: { outcome: "success" } }],
      new Error("lore-api said 503"),
    );

    expect(await handle(brief, TOOLS)).toEqual({
      outcome: "failed",
      error: "lore-api said 503",
    });
  });
});
