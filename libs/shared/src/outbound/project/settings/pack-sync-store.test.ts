import { describe, expect, it } from "vitest";
import type { PackSyncState } from "../../../domain/models/pack-sync-state.js";
import { parsePackSync } from "./pack-sync-store.js";

const state: PackSyncState = {
  repo: "acme/lore-pack",
  ref: null,
  commit: "9a7b72d96c4cbaadf77c7bcdc9f885dfb099c36d",
  applied_at: "2026-11-17T10:00:00.000Z",
  agent_count: 1,
  line_count: 0,
  extra_count: 0,
  refused_files: [],
  agents: ["acme-triage"],
  pipelines: [],
  error: null,
  error_at: null,
};

describe("parsePackSync", () => {
  it("returns null when the setting is unset", () => {
    expect(parsePackSync(null)).toBeNull();
  });

  it("returns the state stored as JSON text", () => {
    expect(parsePackSync(JSON.stringify(state))).toEqual(state);
  });

  it("throws naming pack.sync when the stored text is not a state", () => {
    expect(() => parsePackSync('{"repo":1}')).toThrow(
      /^lore\.settings pack\.sync is not a pack sync state/,
    );
  });
});
