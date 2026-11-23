import { describe, it, expect } from "vitest";
import { packCardState } from "./pack";

describe("packCardState", () => {
  it("answers null when no pack is configured", () => {
    expect(
      packCardState({
        configured: false,
        repo: null,
        ref: null,
        sync: null,
      }),
    ).toBeNull();
  });

  it("answers an empty sync of acme/lore-pack on main when configured and never synced", () => {
    expect(
      packCardState({
        configured: true,
        repo: "acme/lore-pack",
        ref: "main",
        sync: null,
      }),
    ).toMatchObject({
      repo: "acme/lore-pack",
      ref: "main",
      commit: null,
      agent_count: 0,
      skill_count: 0,
      skills: [],
      error: null,
    });
  });

  it("answers the recorded sync once one has run", () => {
    const sync = {
      repo: "acme/lore-pack",
      ref: null,
      commit: "9a7b72d96c4cbaadf77c7bcdc9f885dfb099c36d",
      applied_at: "2026-11-17T10:30:00.000Z",
      agent_count: 3,
      line_count: 1,
      extra_count: 2,
      refused_files: [],
      agents: ["acme-triage"],
      pipelines: ["acme-flow"],
      skill_count: 1,
      skills: ["acme-review"],
      error: null,
      error_at: null,
    };

    expect(
      packCardState({
        configured: true,
        repo: "acme/lore-pack",
        ref: null,
        sync,
      }),
    ).toEqual(sync);
  });
});
