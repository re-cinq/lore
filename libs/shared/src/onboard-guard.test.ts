import { describe, it, expect } from "vitest";
import {
  decideOnboard,
  onboardLockKey,
  onboardTaskDescription,
  toOnboardState,
  IN_FLIGHT_TASK_STATUSES,
  ONBOARD_IN_FLIGHT_TASK_SQL,
  type OnboardState,
} from "./onboard-guard.js";

const clear: OnboardState = {
  onboardingPrMerged: false,
  openOnboardingPrUrl: null,
  inFlightTaskId: null,
  ingested: false,
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

  it("blocks already-onboarded for an ingested repo whose merged flag was never set", () => {
    expect(decideOnboard("o/r", { ...clear, ingested: true })).toMatchObject({
      allowed: false,
      block: "already-onboarded",
    });
  });

  it("allows an ingested repo when reonboard is requested", () => {
    expect(
      decideOnboard("o/r", { ...clear, ingested: true }, { reonboard: true }),
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

  it("blocks pr-open even for an explicit reonboard", () => {
    expect(
      decideOnboard(
        "o/r",
        { ...clear, openOnboardingPrUrl: "https://github.com/o/r/pull/7" },
        { reonboard: true },
      ),
    ).toMatchObject({ allowed: false, block: "pr-open", taskId: null });
  });
});

describe("IN_FLIGHT_TASK_STATUSES", () => {
  it("covers every status an onboard task holds before it terminates", () => {
    expect(IN_FLIGHT_TASK_STATUSES).toEqual([
      "pending",
      "queued",
      "awaiting_approval",
      "running",
      "running-local",
      "review",
      "pr-created",
    ]);
  });
});

describe("ONBOARD_IN_FLIGHT_TASK_SQL", () => {
  it("excludes a pr-created task with no recorded PR from the in-flight set", () => {
    expect(ONBOARD_IN_FLIGHT_TASK_SQL).toContain(
      "status != 'pr-created' OR pr_url IS NOT NULL",
    );
  });
});

describe("toOnboardState", () => {
  it("reads a missing repo row as not onboarded with nothing in flight", () => {
    expect(toOnboardState(undefined, undefined)).toEqual(clear);
  });

  it("masks the onboarding PR url once that PR merged", () => {
    expect(
      toOnboardState(
        { onboarding_pr_merged: true, onboarding_pr_url: "https://x/pull/1" },
        undefined,
      ),
    ).toEqual({
      onboardingPrMerged: true,
      openOnboardingPrUrl: null,
      inFlightTaskId: null,
      ingested: false,
    });
  });

  it("keeps the onboarding PR url while that PR is unmerged", () => {
    expect(
      toOnboardState(
        { onboarding_pr_merged: false, onboarding_pr_url: "https://x/pull/1" },
        { id: "task-3" },
      ),
    ).toEqual({
      onboardingPrMerged: false,
      openOnboardingPrUrl: "https://x/pull/1",
      inFlightTaskId: "task-3",
      ingested: false,
    });
  });

  it("reads a set last_ingested_at as ingested", () => {
    expect(
      toOnboardState({ last_ingested_at: "2026-01-01T00:00:00Z" }, undefined),
    ).toEqual({ ...clear, ingested: true });
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
