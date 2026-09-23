import { describe, it, expect } from "vitest";
import { findParkedAuthorNode } from "./plan-run.js";
import type { PlanningRunPort } from "./plan-run.js";

const PLANNING = "feature-planning";

const port = (
  runs: Array<{
    id: string;
    blueprintName: string;
    status: string;
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
