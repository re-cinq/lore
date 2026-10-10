import { describe, it, expect } from "vitest";
import { typeFamilyOf } from "./node-type-family";

describe("typeFamilyOf", () => {
  it.each([
    ["agent", "agent"],
    ["validate", "service"],
    ["detect", "service"],
    ["merge_step", "service"],
    ["pr_review", "person"],
    ["feature_review", "person"],
    ["ci_check", "person"],
    ["retrospective", "marker"],
  ])("files a %s node under %s", (nodeType, family) => {
    expect(typeFamilyOf(nodeType)).toBe(family);
  });

  it("files a node with no type under marker", () => {
    expect(typeFamilyOf(undefined)).toBe("marker");
  });
});
