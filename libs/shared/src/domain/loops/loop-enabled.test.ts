import { describe, expect, it } from "vitest";
import {
  autoMergeMinAgeHours,
  issueTriageEnabled,
  loopEnabled,
} from "./loop-enabled.js";
import { isLoopKey, LOOP_KEYS, loopKind } from "./loop-kinds.js";

describe("issueTriageEnabled", () => {
  it("returns true when the issue_triage block is absent", () => {
    expect(issueTriageEnabled({})).toBe(true);
    expect(issueTriageEnabled(null)).toBe(true);
  });

  it("returns false only when enabled is the boolean false", () => {
    expect(issueTriageEnabled({ issue_triage: { enabled: false } })).toBe(
      false,
    );
    expect(issueTriageEnabled({ issue_triage: { enabled: "no" } })).toBe(true);
  });

  it("reads a settings column handed over as a JSON string", () => {
    expect(issueTriageEnabled('{"issue_triage":{"enabled":false}}')).toBe(
      false,
    );
  });
});

describe("loopEnabled", () => {
  it("answers implementation from implementation_loop.enabled, off by default", () => {
    expect(loopEnabled("implementation", {})).toBe(false);
    expect(
      loopEnabled("implementation", { implementation_loop: { enabled: true } }),
    ).toBe(true);
  });

  it("answers review from the top-level auto_review flag, off by default", () => {
    expect(loopEnabled("review", {})).toBe(false);
    expect(loopEnabled("review", { auto_review: true })).toBe(true);
  });

  it("answers merge on only when auto_merge.enabled is the boolean true", () => {
    expect(
      [true, false, "yes", undefined].map((enabled) =>
        loopEnabled("merge", { auto_merge: { enabled } }),
      ),
    ).toEqual([true, false, false, false]);
  });

  it("reads the minimum age as auto_merge.min_age_hours, 24 when absent, negative or fractional", () => {
    expect(
      [6, 0, undefined, -1, 1.5].map((min_age_hours) =>
        autoMergeMinAgeHours({ auto_merge: { min_age_hours } }),
      ),
    ).toEqual([6, 0, 24, 24, 24]);
  });

  it("answers triage from issue_triage.enabled, on by default", () => {
    expect(loopEnabled("triage", {})).toBe(true);
    expect(loopEnabled("triage", { issue_triage: { enabled: false } })).toBe(
      false,
    );
  });
});

describe("loop kinds", () => {
  it("lists implementation, review, merge then triage with their full names", () => {
    expect(LOOP_KEYS).toEqual(["implementation", "review", "merge", "triage"]);
    expect(loopKind("triage")).toMatchObject({ label: "Issue triage" });
  });

  it("isLoopKey rejects a key no loop has", () => {
    expect(isLoopKey("triage")).toBe(true);
    expect(isLoopKey("upkeep")).toBe(false);
    expect(isLoopKey(undefined)).toBe(false);
  });
});
