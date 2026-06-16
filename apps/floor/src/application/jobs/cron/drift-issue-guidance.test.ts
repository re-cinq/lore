import { describe, it, expect } from "vitest";
import { isDriftTask, DRIFT_ISSUE_GUIDANCE } from "./drift-issue-guidance.js";

describe("isDriftTask", () => {
  it("returns true for a gap-fill task carrying a spec_path", () => {
    expect(
      isDriftTask({ task_type: "gap-fill", context_bundle: { spec_path: "specs/x/spec.md" } }),
    ).toBe(true);
  });

  it("returns false for a gap-fill task without a spec_path", () => {
    expect(isDriftTask({ task_type: "gap-fill", context_bundle: { details: "..." } })).toBe(false);
  });

  it("returns false for a non-gap-fill task even with a spec_path", () => {
    expect(
      isDriftTask({ task_type: "implementation", context_bundle: { spec_path: "specs/x/spec.md" } }),
    ).toBe(false);
  });

  it("returns false when context_bundle is absent", () => {
    expect(isDriftTask({ task_type: "gap-fill" })).toBe(false);
  });
});

describe("DRIFT_ISSUE_GUIDANCE", () => {
  it("leads with the What you should actually do heading", () => {
    expect(DRIFT_ISSUE_GUIDANCE).toMatch(/What you should actually do/);
  });

  it("tells the reader to decide spec-vs-code and to close false positives", () => {
    expect(DRIFT_ISSUE_GUIDANCE).toMatch(/update the spec/i);
    expect(DRIFT_ISSUE_GUIDANCE).toMatch(/close[\s\S]*stale/i);
  });
});
