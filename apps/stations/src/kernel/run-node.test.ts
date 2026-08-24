import { describe, it, expect } from "vitest";
import { runPublishedNode } from "./run-node.js";
import type { NodeResult } from "@re-cinq/lore-assembly-lines";

const EVENT = {
  stationRunId: "sr-1",
  assemblyLineId: "run-1",
  nodeId: "file",
  iteration: 1,
  nodeType: "issues",
  repo: "re-cinq/lore",
  branch: "feat/x",
  taskId: null,
  params: { feature_decomposition: "{}" },
};

function capture() {
  const reported: Array<{ outcome: string; result?: NodeResult }> = [];

  return {
    reported,
    report: async (
      _target: unknown,
      outcome: string,
      _args: unknown,
      result?: unknown,
    ) => {
      reported.push({ outcome, result: result as NodeResult });
    },
  };
}

describe("runPublishedNode", () => {
  it("reports the station's whole result, not only its outcome", async () => {
    const seen = capture();

    await runPublishedNode(EVENT, seen.report, async () => ({
      outcome: "success",
      extras: { action: "address" },
    }));

    expect(seen.reported[0]).toMatchObject({
      outcome: "success",
      result: { outcome: "success", extras: { action: "address" } },
    });
  });

  it("reports the node back against the visit it was published for", async () => {
    const targets: Array<{
      lineId: string;
      nodeId: string;
      iteration: number;
    }> = [];

    await runPublishedNode(
      EVENT,
      async (target) => {
        targets.push(target as never);
      },
      async () => ({ outcome: "success" }),
    );

    expect(targets).toEqual([
      { lineId: "run-1", nodeId: "file", iteration: 1 },
    ]);
  });

  it("reports a thrown station as a failed node rather than retrying it on the bus", async () => {
    const seen = capture();

    await runPublishedNode(EVENT, seen.report, async () => {
      throw new Error("the artifact was missing");
    });

    expect(seen.reported[0]?.result).toMatchObject({
      outcome: "failed",
      failureDetail: "the artifact was missing",
    });
  });

  it("refuses a node type no station claims, rather than reporting a false success", async () => {
    const seen = capture();

    await runPublishedNode({ ...EVENT, nodeType: "nosuchtype" }, seen.report);

    expect(seen.reported[0]?.result).toMatchObject({ outcome: "failed" });
    expect(seen.reported[0]?.result?.failureDetail).toContain("nosuchtype");
  });
});
