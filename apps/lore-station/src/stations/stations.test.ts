import { describe, it, expect } from "vitest";
import { runGateStation } from "./gate.js";
import { runGithubActionStation } from "./github-action.js";
import type { StationInput } from "../input.js";

const input = (over: Partial<StationInput> = {}): StationInput => ({
  assembly_line_id: "al-1",
  node_id: "n",
  node_type: "gate",
  repo: "o/r",
  branch: "lore/x",
  task_id: "t-1",
  params: {},
  ...over,
});

describe("runGateStation", () => {
  it("returns success and echoes the condition_ref", async () => {
    expect(await runGateStation(input({ params: { condition_ref: "auto_merge_eligible" } }))).toEqual({
      outcome: "success",
      extras: { "Lore-Gate": "auto_merge_eligible" },
    });
    expect((await runGateStation(input())).extras).toEqual({ "Lore-Gate": "none" });
  });
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
      const result = await runGithubActionStation(input(), undefined, { maxPolls: 0, sleep: async () => {} });
      expect(result).toMatchObject({ outcome: "failed", extras: { "Lore-CI-Conclusion": "timeout" } });
    });
  });
});

import { runDetectStation } from "./detect.js";
import type { Project } from "@re-cinq/lore-shared";

describe("runDetectStation", () => {
  it("dispatches by job_ref and returns the detector summary (capped)", async () => {
    const fakeProject = { chunks: { specChunks: async () => [] } } as unknown as Project;
    const result = await runDetectStation(
      input({ node_type: "detect", params: { job_ref: "spec_drift" } }),
      undefined,
      () => fakeProject,
    );
    // spec_drift with no specs returns "No specs found"
    expect(result).toEqual({ outcome: "success", extras: { "Lore-Detect-Summary": "No specs found" } });
  });

  it("throws on an unknown job_ref", async () => {
    await expect(
      runDetectStation(input({ node_type: "detect", params: { job_ref: "nope" } }), undefined, () => ({}) as never),
    ).rejects.toThrow(/no detector for job_ref "nope"/);
  });
});
