// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { loadFloorRunsPage } from "./floor-runs-page";
import { serveLiveRequests } from "./live-socket/answering-socket";
import type { components } from "./api/schema";

const wireRun: components["schemas"]["FloorRunPage"]["runs"][number] = {
  id: "run-3",
  blueprint_name: "code-review",
  definition_name: "code-review",
  task_id: null,
  repo: "re-cinq/lore",
  branch: null,
  subject_key: null,
  engine: "floor",
  status: "failed",
  outcome: "failed",
  reason: null,
  created_at: "2026-10-02T09:00:00.000Z",
  started_at: null,
  finished_at: null,
  args_pr_number: null,
  spec_plan_summary: null,
  pr_url: null,
  task_pr_number: null,
  issue_url: null,
  issue_number: null,
  created_by: null,
  cost_usd: null,
  pipeline: [{ node_id: "review", state: "failed" }],
};

describe("loadFloorRunsPage", () => {
  it("loads the page after page-2 of failed runs in re-cinq/lore over the socket, with its stages and next cursor page-3", async () => {
    const asked = serveLiveRequests(() => ({
      status: 200,
      body: { runs: [wireRun], next_cursor: "page-3" },
    }));

    const page = await loadFloorRunsPage({
      repo: "re-cinq/lore",
      status: "failed",
      cursor: "page-2",
    });

    expect({
      asked: asked.map((request) => `${request.method} ${request.path}`),
      ids: page.runs.map((run) => run.id),
      stages: page.runs[0].pipeline,
      nextCursor: page.nextCursor,
    }).toEqual({
      asked: [
        "GET /api/floor-runs?repo=re-cinq%2Flore&status=failed&cursor=page-2",
      ],
      ids: ["run-3"],
      stages: [{ node_id: "review", state: "failed" }],
      nextCursor: "page-3",
    });
  });

  it("answers an empty page when lore-api refuses", async () => {
    serveLiveRequests(() => ({ status: 403, body: { error: "forbidden" } }));

    expect(await loadFloorRunsPage({})).toEqual({
      runs: [],
      nextCursor: null,
    });
  });
});
