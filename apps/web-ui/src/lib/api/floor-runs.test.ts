// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { components } from "./schema";

vi.mock("server-only", () => ({}));

const { getFloorRuns } = await import("./floor-runs");

type FloorRunPage = components["schemas"]["FloorRunPage"];

const wirePage: FloorRunPage = {
  runs: [
    {
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
    },
  ],
  next_cursor: "page-3",
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.LORE_API_URL = "http://api:3000";
  process.env.LORE_ADMIN_TOKEN = "admin";
  fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(wirePage)));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.LORE_ADMIN_TOKEN;
});

describe("getFloorRuns", () => {
  it("asks for status failed after page-2 and answers the mapped rows with stages and next cursor page-3", async () => {
    const page = await getFloorRuns({ status: "failed", cursor: "page-2" });
    const asked = new URL(String(fetchMock.mock.calls[0][0]));

    expect({ asked: `${asked.pathname}${asked.search}`, page }).toMatchObject({
      asked: "/api/floor-runs?status=failed&cursor=page-2",
      page: {
        runs: [
          {
            id: "run-3",
            blueprintName: "code-review",
            status: "failed",
            pipeline: [{ node_id: "review", state: "failed" }],
          },
        ],
        nextCursor: "page-3",
      },
    });
  });

  it("asks for repo re-cinq/lore, status running and cursor page-2 in that order", async () => {
    await getFloorRuns({
      repo: "re-cinq/lore",
      status: "running",
      cursor: "page-2",
    });
    const asked = new URL(String(fetchMock.mock.calls[0][0]));

    expect(`${asked.pathname}${asked.search}`).toEqual(
      "/api/floor-runs?repo=re-cinq%2Flore&status=running&cursor=page-2",
    );
  });
});
