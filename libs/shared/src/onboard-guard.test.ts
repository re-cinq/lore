import { describe, it, expect } from "vitest";
import {
  decideOnboard,
  onboardLockKey,
  onboardTaskDescription,
  type OnboardState,
} from "./onboard-guard.js";

const clear: OnboardState = {
  onboardingPrMerged: false,
  openOnboardingPrUrl: null,
  inFlightTaskId: null,
};

describe("decideOnboard", () => {
  it("allows a repo with no row, no PR, and no task in flight", () => {
    expect(decideOnboard("o/r", clear)).toEqual({ allowed: true });
  });

  it("blocks in-flight and returns the running task id", () => {
    expect(
      decideOnboard("o/r", { ...clear, inFlightTaskId: "task-1" }),
    ).toMatchObject({
      allowed: false,
      block: "in-flight",
      taskId: "task-1",
    });
  });

  it("blocks in-flight even for an explicit reonboard", () => {
    expect(
      decideOnboard(
        "o/r",
        { ...clear, inFlightTaskId: "task-1" },
        { reonboard: true },
      ),
    ).toMatchObject({ allowed: false, block: "in-flight" });
  });

  it("blocks already-onboarded when the onboarding PR merged", () => {
    expect(
      decideOnboard("o/r", { ...clear, onboardingPrMerged: true }),
    ).toMatchObject({
      allowed: false,
      block: "already-onboarded",
      taskId: null,
      message: expect.stringContaining("already onboarded"),
    });
  });

  it("allows an already-onboarded repo when reonboard is requested", () => {
    expect(
      decideOnboard(
        "o/r",
        { ...clear, onboardingPrMerged: true },
        { reonboard: true },
      ),
    ).toEqual({ allowed: true });
  });

  it("blocks pr-open when an unmerged onboarding PR exists", () => {
    expect(
      decideOnboard("o/r", {
        ...clear,
        openOnboardingPrUrl: "https://github.com/o/r/pull/7",
      }),
    ).toMatchObject({
      allowed: false,
      block: "pr-open",
      message: expect.stringContaining("https://github.com/o/r/pull/7"),
    });
  });
});

describe("onboardLockKey", () => {
  it("keys on the repo full name", () => {
    expect(onboardLockKey("o/r")).toBe("lore.onboard:o/r");
    expect(onboardLockKey("o/other")).not.toBe(onboardLockKey("o/r"));
  });
});

describe("onboardTaskDescription", () => {
  it("names the repo and the work instead of sending a bare repo name", () => {
    const description = onboardTaskDescription("o/r");

    expect(description).toContain("o/r");
    expect(description.length).toBeGreaterThan("o/r".length);
  });
});
