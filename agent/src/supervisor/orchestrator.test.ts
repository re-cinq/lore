import { describe, it, expect } from "vitest";
import {
  buildBranchName,
  isDarkFactoryEligible,
} from "./orchestrator.js";

describe("isDarkFactoryEligible (worker dispatch gate)", () => {
  it("routes gap-fill through the supervisor", () => {
    expect(isDarkFactoryEligible("gap-fill")).toBe(true);
  });

  it("routes runbook through the supervisor", () => {
    expect(isDarkFactoryEligible("runbook")).toBe(true);
  });

  it("does NOT route implementation (Claude-Code-driven, needs Job pod refactor)", () => {
    expect(isDarkFactoryEligible("implementation")).toBe(false);
  });

  it("does NOT route general (Claude-Code-driven)", () => {
    expect(isDarkFactoryEligible("general")).toBe(false);
  });

  it("does NOT route review (review-comment-driven via gh CLI)", () => {
    expect(isDarkFactoryEligible("review")).toBe(false);
  });

  it("does NOT route onboard (handled by handleOnboard directly)", () => {
    expect(isDarkFactoryEligible("onboard")).toBe(false);
  });

  it("does NOT route feature-request (handled by handleFeatureRequest)", () => {
    expect(isDarkFactoryEligible("feature-request")).toBe(false);
  });

  it("does NOT route unknown task types", () => {
    expect(isDarkFactoryEligible("nonsense")).toBe(false);
  });
});

describe("buildBranchName", () => {
  it("derives lore/<type>/<slug>-<id8> for a normal description", () => {
    expect(
      buildBranchName({
        id: "abcd1234-ef56-7890-abcd-1234567890ab",
        description: "Add retry logic",
        task_type: "gap-fill",
      }),
    ).toBe("lore/gap-fill/add-retry-logic-abcd1234");
  });

  it("collapses non-alphanumerics into single dashes", () => {
    expect(
      buildBranchName({
        id: "11111111",
        description: "Fix: race-condition (in middleware)",
        task_type: "runbook",
      }),
    ).toBe("lore/runbook/fix-race-condition-in-middlewa-11111111");
  });

  it("strips leading/trailing dashes from the slug", () => {
    expect(
      buildBranchName({
        id: "22222222",
        description: "  --- weird  spacing ---  ",
        task_type: "general",
      }),
    ).toBe("lore/general/weird-spacing-22222222");
  });

  it("caps slug length at 30 characters", () => {
    const desc =
      "this description is intentionally very long to verify the slug cap works correctly";
    const branch = buildBranchName({
      id: "33333333",
      description: desc,
      task_type: "implementation",
    });
    // Slug is between "lore/<type>/" and "-<id8>"; verify the length cap.
    const slug = branch
      .replace(/^lore\/[^/]+\//, "")
      .replace(/-33333333$/, "");
    expect(slug.length).toBeLessThanOrEqual(30);
  });

  it("uses only the first 8 chars of the task id", () => {
    expect(
      buildBranchName({
        id: "0123456789abcdef-not-included",
        description: "test",
        task_type: "gap-fill",
      }),
    ).toBe("lore/gap-fill/test-01234567");
  });
});
