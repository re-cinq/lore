import { describe, it, expect } from "vitest";
import {
  canFinalize,
  latestReadyGap,
  resolveRoundBasis,
  slugifyTitle,
  slugifyFeatureTitle,
} from "./features-port.js";
import type { FeatureIteration, FeatureStatus } from "./features-port.js";
import type { GapResult } from "../../feature-planning/gap-result.js";

const gap = (tag: string): GapResult => ({
  sections: [{ title: "Overview", content: tag }],
  draft_spec_markdown: `# ${tag}`,
});

function iteration(
  partial: Partial<FeatureIteration> &
    Pick<FeatureIteration, "iteration" | "status">,
): FeatureIteration {
  return {
    id: `it-${partial.iteration}`,
    feature_id: "f1",
    task_id: null,
    user_answers: null,
    gap_result: null,
    parent_iteration: null,
    created_at: "2026-06-18T00:00:00Z",
    updated_at: "2026-06-18T00:00:00Z",
    ...partial,
  };
}

describe("canFinalize", () => {
  it("allows finalizing only from a settled planning state", () => {
    const settled: FeatureStatus[] = ["awaiting-input", "spec-ready"];

    expect(settled.map(canFinalize)).toEqual([true, true]);
  });

  it("rejects finalizing from any other status", () => {
    const other: FeatureStatus[] = [
      "draft",
      "planning",
      "pr-open",
      "implemented",
    ];

    expect(other.map(canFinalize)).toEqual([false, false, false, false]);
  });
});

describe("latestReadyGap", () => {
  it("returns the gap of the highest-numbered ready iteration", () => {
    const iterations = [
      iteration({ iteration: 0, status: "ready", gap_result: gap("round0") }),
      iteration({ iteration: 1, status: "ready", gap_result: gap("round1") }),
      iteration({ iteration: 2, status: "running" }),
    ];

    expect(latestReadyGap(iterations)?.sections[0].content).toBe("round1");
  });

  it("skips failed iterations and ready iterations with no gap_result", () => {
    const iterations = [
      iteration({ iteration: 0, status: "ready", gap_result: gap("round0") }),
      iteration({ iteration: 1, status: "ready", gap_result: null }),
      iteration({ iteration: 2, status: "failed" }),
    ];

    expect(latestReadyGap(iterations)?.sections[0].content).toBe("round0");
  });

  it("returns null when no iteration is ready with a gap", () => {
    expect(
      latestReadyGap([iteration({ iteration: 0, status: "running" })]),
    ).toBeNull();
  });
});

describe("resolveRoundBasis", () => {
  const rounds = [
    iteration({ iteration: 1, status: "ready", gap_result: gap("one") }),
    iteration({ iteration: 2, status: "ready", gap_result: gap("two") }),
    iteration({ iteration: 3, status: "failed" }),
  ];

  it("builds on the latest ready round when the author named none", () => {
    expect(resolveRoundBasis(rounds)).toMatchObject({
      ok: true,
      basis: { iteration: 2 },
    });
  });

  it("builds on the round the author rewound to", () => {
    expect(resolveRoundBasis(rounds, 1)).toMatchObject({
      ok: true,
      basis: { iteration: 1 },
    });
  });

  it("rejects rewinding to a round that produced nothing", () => {
    expect(resolveRoundBasis(rounds, 3)).toEqual({
      ok: false,
      error: "round 3 produced no result to continue from",
    });
  });

  it("rejects a round the feature never had", () => {
    expect(resolveRoundBasis(rounds, 9)).toEqual({
      ok: false,
      error: "no round 9 for this feature",
    });
  });

  it("builds on nothing for a feature with no ready round yet", () => {
    expect(resolveRoundBasis([rounds[2]])).toEqual({ ok: true, basis: null });
  });
});

describe("slugifyTitle", () => {
  it("never ends a 60-char feature slug in a dash when the cut lands on one", () => {
    const title = `${"a".repeat(59)} tail`;

    expect(slugifyFeatureTitle(title)).toBe("a".repeat(59));
  });

  it("names an unslugabble feature title `feature` and leaves a task slug empty", () => {
    expect(slugifyFeatureTitle("!!!")).toBe("feature");
    expect(slugifyTitle("!!!", 30)).toBe("");
  });

  it("caps at the max it is given", () => {
    const title = "this is a very long description that exceeds thirty chars";

    expect(slugifyTitle(title, 30).length).toBeLessThanOrEqual(30);
    expect(slugifyTitle(title, 60).length).toBeLessThanOrEqual(60);
  });
});
