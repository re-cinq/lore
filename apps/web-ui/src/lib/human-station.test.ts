import { describe, it, expect } from "vitest";
import { humanStation, HUMAN_STATIONS, waitingOnPerson } from "./human-station";
import { featurePlanningDefinition } from "./definition-fixtures";

describe("humanStation", () => {
  it("answers the full meta for feature_review", () => {
    expect(humanStation("feature_review")).toEqual({
      label: "Waiting for you",
      phase: "awaiting-author",
      whyParked:
        "Parked — waiting for you: open the plan to refine or approve it.",
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
      "ci_check",
      "feature_review",
      "pr_review",
    ]);
  });
});

describe("waitingOnPerson", () => {
  const visit = (nodeId: string, outcome: string | null) => ({
    nodeId,
    outcome,
  });

  it("answers Waiting for you when the only open visit is on author", () => {
    expect(
      waitingOnPerson(featurePlanningDefinition, [
        visit("analyze", "success"),
        visit("author", null),
      ]),
    ).toBe("Waiting for you");
  });

  it("answers Waiting for the spec PR when the open visit is on merged", () => {
    expect(
      waitingOnPerson(featurePlanningDefinition, [visit("merged", null)]),
    ).toBe("Waiting for the spec PR");
  });

  it("answers null while the agent's analyze visit is open", () => {
    expect(
      waitingOnPerson(featurePlanningDefinition, [
        visit("author", "changes_requested"),
        visit("analyze", null),
      ]),
    ).toBeNull();
  });

  it("answers null for a run with no open visit, and for one with no definition", () => {
    expect([
      waitingOnPerson(featurePlanningDefinition, [visit("analyze", "success")]),
      waitingOnPerson(null, [visit("author", null)]),
    ]).toEqual([null, null]);
  });
});
