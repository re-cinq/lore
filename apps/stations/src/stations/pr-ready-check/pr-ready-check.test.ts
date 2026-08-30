import { describe, expect, it } from "vitest";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import type { ParkedTarget } from "@re-cinq/lore-shared/project/assembly-runs/parked-node.js";
import { prReadyCheckSweep, type PrReadyCheckDeps } from "./pr-ready-check.js";

import type { RunGraph } from "@re-cinq/lore-shared/project/assembly-runs/run-graph.js";

const graph: RunGraph = {
  name: "implementation-loop",
  entry: "implement",
  exit: "done",
  nodes: [
    {
      id: "implement",
      type: "agent",
      station: "agent",
      station_inherited: true,
    },
    {
      id: "await-pr",
      type: "pr_review",
      station: "pr-review",
      station_inherited: true,
    },
  ],
  edges: [],
};

function deps(overrides: Partial<PrReadyCheckDeps> = {}) {
  const reported: Array<{ target: ParkedTarget; outcome: string }> = [];
  const base: PrReadyCheckDeps = {
    listOpenLoopRuns: async () => [
      {
        id: "run-1",
        repo: "acme/widgets",
        status: "running",
        args: { pr_number: 12 },
        graph,
      },
    ],
    listStationRuns: async () => [
      { nodeId: "implement", iteration: 1, outcome: "success" },
      { nodeId: "await-pr", iteration: 1, outcome: null },
    ],
    getPrHeadSha: async () => "deadbeef",
    hasCiHistory: async () => true,
    ciConclusion: async () => "success",
    listReviewThreads: async () => [],
    countOpenReviewRuns: async () => 0,
    report: async (target, outcome) => {
      reported.push({ target, outcome });
    },
  };

  return { deps: { ...base, ...overrides }, reported };
}

describe("prReadyCheckSweep", () => {
  it("resumes a green thread-clean parked run with success", async () => {
    const d = deps();

    const summary = await prReadyCheckSweep(d.deps);

    expect(d.reported).toEqual([
      {
        target: { lineId: "run-1", nodeId: "await-pr", iteration: 1 },
        outcome: "success",
      },
    ]);
    expect(summary).toBe("checked 1, resumed 1, blocked 0, waiting 0");
  });

  it("resumes with changes_requested when CI is red", async () => {
    const d = deps({ ciConclusion: async () => "failure" });

    await prReadyCheckSweep(d.deps);

    expect(d.reported).toEqual([
      {
        target: { lineId: "run-1", nodeId: "await-pr", iteration: 1 },
        outcome: "changes_requested",
      },
    ]);
  });

  it("reports nothing while CI is pending", async () => {
    const d = deps({ ciConclusion: async () => "pending" });

    const summary = await prReadyCheckSweep(d.deps);

    expect(d.reported).toEqual([]);
    expect(summary).toBe("checked 1, resumed 0, blocked 0, waiting 1");
  });

  it("reports nothing when a CI-running repo has no checks yet for the head sha", async () => {
    // The push-to-first-check window. Resuming here passed a build nobody ran.
    const d = deps({
      ciConclusion: async () => "none",
      hasCiHistory: async () => true,
    });

    const summary = await prReadyCheckSweep(d.deps);

    expect(d.reported).toEqual([]);
    expect(summary).toBe("checked 1, resumed 0, blocked 0, waiting 1");
  });

  it("resumes a repo that runs no checks at all, so it cannot wedge its loop", async () => {
    const d = deps({
      ciConclusion: async () => "none",
      hasCiHistory: async () => false,
    });

    const summary = await prReadyCheckSweep(d.deps);

    expect(summary).toBe("checked 1, resumed 1, blocked 0, waiting 0");
  });

  it("waits on unresolved threads while a review-family run is open", async () => {
    const d = deps({
      listReviewThreads: async () => [
        { id: "PRRT_1", isResolved: false, isOutdated: false, comments: [] },
      ],
      countOpenReviewRuns: async () => 1,
    });

    await prReadyCheckSweep(d.deps);

    expect(d.reported).toEqual([]);
  });

  it("skips a run that is not parked at a pr_review node", async () => {
    const d = deps({
      listStationRuns: async () => [
        { nodeId: "implement", iteration: 1, outcome: null },
      ],
    });

    const summary = await prReadyCheckSweep(d.deps);

    expect(d.reported).toEqual([]);
    expect(summary).toBe("checked 1, resumed 0, blocked 0, waiting 0");
  });

  it("skips a parked run whose args carry no pr_number", async () => {
    const d = deps({
      listOpenLoopRuns: async () => [
        {
          id: "run-1",
          repo: "acme/widgets",
          status: "running",
          args: {},
          graph,
        },
      ],
    });

    await prReadyCheckSweep(d.deps);

    expect(d.reported).toEqual([]);
  });

  it("keeps sweeping when one run's PR read throws", async () => {
    const d = deps({
      listOpenLoopRuns: async () => [
        {
          id: "run-err",
          repo: "acme/widgets",
          status: "running",
          args: { pr_number: 1 },
          graph,
        },
        {
          id: "run-ok",
          repo: "acme/widgets",
          status: "running",
          args: { pr_number: 2 },
          graph,
        },
      ],
      getPrHeadSha: async (_repo, number) => {
        enforceTrue(number !== 1, Error, "boom");

        return "cafebabe";
      },
    });

    const summary = await prReadyCheckSweep(d.deps);

    expect(d.reported).toEqual([
      {
        target: { lineId: "run-ok", nodeId: "await-pr", iteration: 1 },
        outcome: "success",
      },
    ]);
    expect(summary).toBe(
      "checked 2, resumed 1, blocked 0, waiting 0, errors 1",
    );
  });
});
