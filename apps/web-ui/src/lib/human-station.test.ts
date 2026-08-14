import { describe, it, expect } from "vitest";
import { humanStation, HUMAN_STATIONS } from "./human-station";

describe("humanStation", () => {
  it("answers the full meta for feature_review", () => {
    expect(humanStation("feature_review")).toEqual({
      label: "Waiting for you",
      phase: "awaiting-author",
      whyParked: "Parked — waiting for you to review this round.",
    });
  });

  it("answers the full meta for pr_review", () => {
    expect(humanStation("pr_review")).toEqual({
      label: "Waiting for the spec PR",
      phase: "awaiting-merge",
      whyParked: "Parked — waiting for the spec PR to merge.",
    });
  });

  it("answers null for a pod-worked node type", () => {
    expect(humanStation("agent")).toBeNull();
    expect(humanStation("retrospective")).toBeNull();
  });

  it("answers null for an absent type", () => {
    expect(humanStation(null)).toBeNull();
    expect(humanStation(undefined)).toBeNull();
  });

  it("carries every human station type — the record IS the registration", () => {
    expect(Object.keys(HUMAN_STATIONS).sort()).toEqual([
      "feature_review",
      "pr_review",
    ]);
  });
});
