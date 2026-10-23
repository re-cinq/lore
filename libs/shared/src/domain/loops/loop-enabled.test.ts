import { describe, expect, it } from "vitest";
import { issueTriageEnabled, loopEnabled } from "./loop-enabled.js";
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

  it("answers triage from issue_triage.enabled, on by default", () => {
    expect(loopEnabled("triage", {})).toBe(true);
    expect(loopEnabled("triage", { issue_triage: { enabled: false } })).toBe(
      false,
    );
  });
});

describe("loop kinds", () => {
  it("lists implementation then triage with their full names", () => {
    expect(LOOP_KEYS).toEqual(["implementation", "triage"]);
    expect(loopKind("triage")).toMatchObject({ label: "Issue triage" });
  });

  it("isLoopKey rejects a key no loop has", () => {
    expect(isLoopKey("triage")).toBe(true);
    expect(isLoopKey("review")).toBe(false);
    expect(isLoopKey(undefined)).toBe(false);
  });
});
