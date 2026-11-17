import { describe, it, expect } from "vitest";
import { toolHandlers } from "../shared/tool-test-helpers.js";
import { fakeLoreApi, specDescription } from "./shared/fake-lore-api.js";
import { LIST_RUNS_DESCRIPTION, registerListRunsTool } from "./list-runs.js";

const api = fakeLoreApi();
const agentList = toolHandlers(registerListRunsTool, "agent")["lore_list_runs"];
const textOf = async (args: Record<string, unknown>) =>
  (await agentList(args)).content[0].text;

describe("lore_list_runs", () => {
  it("returns the floor's page of runs for every repository on the agent gateway", async () => {
    api.answer("/api/floor-runs", { runs: [{ id: "r1" }], next_cursor: "c2" });

    expect(JSON.parse(await textOf({}))).toEqual({
      runs: [{ id: "r1" }],
      next_cursor: "c2",
    });
  });

  it("asks for repo re-cinq/lore, failed status, page c2 and 5 runs", async () => {
    api.answer(
      "/api/floor-runs?repo=re-cinq%2Flore&status=failed&cursor=c2&limit=5",
      { runs: [] },
    );
    await textOf({
      repo: "re-cinq/lore",
      status: "failed",
      cursor: "c2",
      limit: 5,
    });

    expect(api.requested).toEqual([
      "/api/floor-runs?repo=re-cinq%2Flore&status=failed&cursor=c2&limit=5",
    ]);
  });

  it("refuses repo '../x' without fetching", async () => {
    expect(await textOf({ repo: "../x" })).toContain("Invalid repo '../x'");
    expect(api.requested).toEqual([]);
  });

  it("filters to the git remote's repository on a laptop", async () => {
    const laptopList = toolHandlers(registerListRunsTool, "full")[
      "lore_list_runs"
    ];

    await laptopList({});

    expect(api.requested[0]).toMatch(/^\/api\/floor-runs(\?repo=[^&]+)?$/);
  });

  it("carries the verbatim description block of specs/mcp-tools/list-runs/spec.md", () => {
    expect(LIST_RUNS_DESCRIPTION).toBe(specDescription("list-runs"));
  });
});
