import { describe, it, expect } from "vitest";
import { runGithubActionStation } from "./github-action.js";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";

const input = (over: Partial<StationInput> = {}): StationInput => ({
  assembly_run_id: "al-1",
  node_id: "n",
  node_type: "github_action",
  repo: "o/r",
  branch: "lore/x",
  task_id: "t-1",
  params: {},
  ...over,
});

describe("runGithubActionStation", () => {
  const withApi = <T>(fn: () => Promise<T>): Promise<T> => {
    process.env.LORE_API_URL = "https://api";

    return fn().finally(() => delete process.env.LORE_API_URL);
  };

  it("times out to failed after maxPolls of pending CI", async () => {
    await withApi(async () => {
      // No fetch stub → ciConclusion throws; but we only need the poll-budget path,
      // so drive it with maxPolls 0 to hit the timeout branch deterministically.
      const result = await runGithubActionStation(input(), undefined, {
        maxPolls: 0,
        sleep: async () => {},
      });

      expect(result).toMatchObject({
        outcome: "failed",
        extras: { "Lore-CI-Conclusion": "timeout" },
      });
    });
  });
});
