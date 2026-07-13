import { describe, it, expect } from "vitest";
import { canFinalize, latestReadyGap } from "./features-port.js";
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
      "split",
    ];
    expect(other.map(canFinalize)).toEqual([false, false, false, false, false]);
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
