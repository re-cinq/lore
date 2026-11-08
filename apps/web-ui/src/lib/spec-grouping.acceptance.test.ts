import { describe, it, expect } from "vitest";
import { groupSpecSummaries } from "./spec-grouping";

describe("groupSpecSummaries (Acceptance)", () => {
  it("titles a spec.md-less folder from its key, not from a sibling file's title", () => {
    const groups = groupSpecSummaries([
      {
        filePath: "specs/auth/plan.md",
        title: "Plan",
        description: "",
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("auth");
  });
});
