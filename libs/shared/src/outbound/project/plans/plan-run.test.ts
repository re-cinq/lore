import { describe, it, expect } from "vitest";
import { findParkedAuthorNode, planLineState } from "./plan-run.js";
import type { PlanningRunPort } from "./plan-run.js";

const PLANNING = "feature-planning";

const port = (
  runs: Array<{
    id: string;
    blueprintName: string;
    status: string;
    outcome?: string | null;
    args?: object;
    graph?: unknown;
  }>,
  visits: Array<{
    nodeId: string;
    iteration: number;
    outcome: string | null;
  }> = [],
): PlanningRunPort => ({
  listForSubject: async () => runs as never,
  listStationRuns: async () => visits as never,
});

describe("findParkedAuthorNode", () => {
  it("finds nothing when the plan has no planning run", async () => {
    expect(
      await findParkedAuthorNode(
        port([{ id: "r", blueprintName: "something-else", status: "running" }]),
        "f-1",
      ),
    ).toEqual({ runId: null, parked: null });
  });

  it("reports the run but no parked node while the line is mid-flight", async () => {
    const result = await findParkedAuthorNode(
      port(
        [{ id: "r-1", blueprintName: PLANNING, status: "running" }],
        [{ nodeId: "analyze", iteration: 1, outcome: null }],
      ),
      "f-1",
    );

    expect(result).toEqual({ runId: "r-1", parked: null });
  });

  it("names the node a refinement reports to when the line waits on the author", async () => {
    const result = await findParkedAuthorNode(
      port(
        [
          {
            id: "r-1",
            blueprintName: PLANNING,
            status: "running",
            graph: {
              nodes: [
                { id: "analyze", type: "agent" },
                { id: "author", type: "feature_review" },
              ],
              edges: [{ from: "analyze", to: "author", on: "success" }],
              entry: "analyze",
              exit: "author",
            },
          },
        ],
        [
          { nodeId: "analyze", iteration: 1, outcome: "success" },
          { nodeId: "author", iteration: 1, outcome: null },
        ],
      ),
      "f-1",
    );

    expect(result.parked).toMatchObject({ nodeId: "author", lineId: "r-1" });
  });
});

const GRAPH = {
  nodes: [
    { id: "analyze", type: "agent" },
    { id: "author", type: "feature_review" },
    { id: "analyse-specs", type: "agent" },
    { id: "merged", type: "pr_review" },
    { id: "decompose", type: "agent" },
  ],
  edges: [],
  entry: "analyze",
  exit: "decompose",
};

const line = (status: string, args: object = {}) => ({
  id: "r-1",
  blueprintName: PLANNING,
  status,
  outcome: null,
  graph: GRAPH,
  args,
});

describe("planLineState", () => {
  it("answers null for a plan with no planning line", async () => {
    expect(await planLineState(port([]), "p-1")).toBeNull();
  });

  it("names the parked merged node and the spec PR while the line waits on the PR", async () => {
    const state = await planLineState(
      port(
        [line("running", { pr_number: 7 })],
        [
          { nodeId: "author", iteration: 1, outcome: "success" },
          { nodeId: "merged", iteration: 1, outcome: null },
        ],
      ),
      "p-1",
    );

    expect(state).toEqual({
      lineId: "r-1",
      status: "running",
      outcome: null,
      prNumber: 7,
      open: "merged",
      parkedAuthor: null,
      parkedMerged: { lineId: "r-1", nodeId: "merged", iteration: 1 },
      merged: false,
    });
  });

  it("reports the specs merged once the merged node succeeded, with nothing open on a finished line", async () => {
    const state = await planLineState(
      port(
        [{ ...line("finished", { pr_number: 7 }), outcome: "completed" }],
        [
          { nodeId: "merged", iteration: 1, outcome: "success" },
          { nodeId: "decompose", iteration: 1, outcome: "success" },
        ],
      ),
      "p-1",
    );

    expect(state).toMatchObject({
      status: "finished",
      outcome: "completed",
      open: null,
      merged: true,
      parkedMerged: null,
    });
  });

  it("names the open agent node while the specs are being analysed after approval", async () => {
    const state = await planLineState(
      port(
        [line("running")],
        [
          { nodeId: "author", iteration: 1, outcome: "success" },
          { nodeId: "analyse-specs", iteration: 1, outcome: null },
        ],
      ),
      "p-1",
    );

    expect(state).toMatchObject({ open: "analyse-specs", prNumber: null });
  });
});

describe("a plan's run is its open planning run, not merely its newest", () => {
  const graph = {
    nodes: [
      { id: "analyze", type: "agent" },
      { id: "author", type: "feature_review" },
    ],
  };
  const openBehindNewer = port(
    [
      {
        id: "r-new",
        blueprintName: PLANNING,
        status: "finished",
        graph,
        args: {},
      },
      {
        id: "r-old",
        blueprintName: PLANNING,
        status: "running",
        graph,
        args: {},
      },
    ],
    [
      { nodeId: "analyze", iteration: 8, outcome: "failed" },
      { nodeId: "author", iteration: 9, outcome: null },
    ],
  );

  it("reports a refinement to author 9 waiting on the open run r-old, not the newer finished r-new", async () => {
    expect(await findParkedAuthorNode(openBehindNewer, "f-1")).toEqual({
      runId: "r-old",
      parked: { lineId: "r-old", nodeId: "author", iteration: 9 },
    });
  });

  it("reads the plan's state off the open run r-old, parked on its author", async () => {
    expect(await planLineState(openBehindNewer, "f-1")).toMatchObject({
      lineId: "r-old",
      status: "running",
      parkedAuthor: { nodeId: "author", iteration: 9 },
    });
  });
});
