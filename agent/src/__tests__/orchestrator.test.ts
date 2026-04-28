import { describe, it, expect } from "vitest";
import { isDarkFactoryEligible } from "../supervisor/orchestrator.js";

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
