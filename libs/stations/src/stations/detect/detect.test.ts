import { describe, it, expect } from "vitest";
import { runDetectStation } from "./detect.js";
import type { Project } from "@re-cinq/lore-shared";
import type { StationInput } from "@re-cinq/lore-shared/station-input.js";

const input = (over: Partial<StationInput> = {}): StationInput => ({
  assembly_run_id: "al-1",
  node_id: "n",
  node_type: "detect",
  repo: "o/r",
  branch: "lore/x",
  task_id: "t-1",
  params: {},
  ...over,
});

describe("runDetectStation", () => {
  it("dispatches by job_ref and returns the detector summary (capped)", async () => {
    const fakeProject = {
      chunks: { specChunks: async () => [] },
    } as unknown as Project;
    const result = await runDetectStation(
      input({ node_type: "detect", params: { job_ref: "spec_drift" } }),
      undefined,
      () => fakeProject,
    );

    // spec_drift with no specs returns "No specs found"
    expect(result).toEqual({
      outcome: "success",
      extras: { "Lore-Detect-Summary": "No specs found" },
    });
  });

  it("throws on an unknown job_ref", async () => {
    await expect(
      runDetectStation(
        input({ node_type: "detect", params: { job_ref: "nope" } }),
        undefined,
        () => ({}) as never,
      ),
    ).rejects.toThrow(/no detector for job_ref "nope"/);
  });
});
