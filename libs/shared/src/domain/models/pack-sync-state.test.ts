import { describe, expect, it } from "vitest";
import { PackSyncStateSchema } from "./pack-sync-state.js";

const synced = {
  repo: "acme/lore-pack",
  ref: "main",
  commit: "9a7b72d96c4cbaadf77c7bcdc9f885dfb099c36d",
  applied_at: "2026-11-17T10:00:00.000Z",
  agent_count: 3,
  line_count: 1,
  extra_count: 1,
  refused_files: [
    {
      path: "implementation-loop/pipeline.yaml",
      reason: "names a shipped line",
    },
  ],
  agents: ["acme-triage", "loop-dod"],
  pipelines: ["acme-release"],
  error: null,
  error_at: null,
};

describe("PackSyncStateSchema", () => {
  it("accepts the state a successful sync stores", () => {
    expect(PackSyncStateSchema.parse(synced)).toEqual(synced);
  });

  it("accepts the state of a first sync that failed, with no commit applied yet", () => {
    const failed = {
      ...synced,
      ref: null,
      commit: null,
      applied_at: null,
      agent_count: 0,
      line_count: 0,
      extra_count: 0,
      refused_files: [],
      agents: [],
      pipelines: [],
      error: "GET /repos/acme/lore-pack/commits/main answered 404",
      error_at: "2026-11-17T10:15:00.000Z",
    };

    expect(PackSyncStateSchema.parse(failed)).toEqual(failed);
  });

  it("refuses a state with a negative agent count", () => {
    expect(
      PackSyncStateSchema.safeParse({ ...synced, agent_count: -1 }).success,
    ).toBe(false);
  });
});
