import { describe, expect, it } from "vitest";
import { recordedFloor } from "@re-cinq/lore-shared/floor/recorded-floor.js";
import { FloorRunReader } from "./floor-run-reader.js";
import type { AssemblyRunSummary } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-port.js";
import { FloorRunRows, floorEnrichmentOf } from "./floor-run-rows.js";
import { floorWithRunPage, PR_URL } from "./floor-run.fixtures.js";

describe("FloorRunRows", () => {
  it("answers a page of runs as wire rows with the pull request, cost, pipeline and next cursor", async () => {
    const reader = new FloorRunReader(recordedFloor(floorWithRunPage).floor);

    expect(await new FloorRunRows(reader).page({})).toMatchObject({
      runs: [
        {
          id: "run-1",
          blueprint_name: "code-review",
          engine: "floor",
          status: "running",
          pr_url: PR_URL,
          cost_usd: 0.42,
          pipeline: [
            { node_id: "review", state: "running" },
            { node_id: "done", state: "pending" },
          ],
        },
      ],
      next_cursor: "cursor-2",
    });
  });
});

const PLANNING_RUN: AssemblyRunSummary = {
  id: "run-plan",
  blueprintName: "feature-planning",
  taskId: null,
  repo: "re-cinq/lore",
  branch: null,
  subjectKey: "plan_id:p1",
  args: { engine: "floor" },
  status: "running",
  outcome: null,
  reason: null,
  blueprintHash: "hash-1",
  resumedFromRunId: null,
  resumedFromNodeId: null,
  inheritedNodeCount: 0,
  createdAt: new Date("2026-10-05T10:00:00.000Z"),
  startedAt: new Date("2026-10-05T10:00:00.000Z"),
  finishedAt: null,
};

describe("floorEnrichmentOf", () => {
  it("answers issue 42 from the run's issue_url start item", () => {
    const issueUrl = "https://github.com/re-cinq/lore/issues/42";
    const run = { ...PLANNING_RUN, args: { issue_url: issueUrl } };

    expect(floorEnrichmentOf(run, undefined)).toMatchObject({
      issue_url: issueUrl,
      issue_number: 42,
    });
  });

  it("answers no issue when the run names none", () => {
    expect(floorEnrichmentOf(PLANNING_RUN, undefined)).toMatchObject({
      issue_url: null,
      issue_number: null,
    });
  });
});
