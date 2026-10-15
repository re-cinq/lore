import { describe, it, expect } from "vitest";
import { labelForReason } from "./blocked-reason.js";

describe("labelForReason", () => {
  it("labels required_check_missing with the check name build", () => {
    expect(labelForReason("required_check_missing", "build")).toBe(
      "A required check has not run: build",
    );
  });

  it("labels merge_conflict with the base branch main", () => {
    expect(labelForReason("merge_conflict", "main")).toBe(
      "Conflicts with main",
    );
  });

  it("labels needs_code_owner without a detail", () => {
    expect(labelForReason("needs_code_owner", null)).toBe(
      "Needs a code owner's approval",
    );
  });

  it("returns null when there is no reason", () => {
    expect(labelForReason(null, null)).toBe(null);
  });

  it("falls back to the code itself for an unknown reason ci_on_fire", () => {
    expect(labelForReason("ci_on_fire", null)).toBe("ci_on_fire");
  });
});
