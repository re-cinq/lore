import { describe, it, expect } from "vitest";
import { groupSpecSummaries, specGroupKey } from "./spec-grouping";

describe("specGroupKey", () => {
  it("folds every file under specs/<name>/ into one spec group key", () => {
    expect(specGroupKey("specs/1-lore-platform/spec.md")).toBe(
      "specs/1-lore-platform",
    );
    expect(
      specGroupKey("specs/1-lore-platform/checklists/requirements.md"),
    ).toBe("specs/1-lore-platform");
  });
  it("groups a non-specs file by its directory", () => {
    expect(specGroupKey(".specify/spec.md")).toBe(".specify");
  });
});

describe("groupSpecSummaries", () => {
  it("collapses a folder of md files into one card titled from spec.md with all files and summed coverage", () => {
    const groups = groupSpecSummaries([
      {
        filePath: "specs/auth/plan.md",
        title: "Plan",
        description: "the plan",
        coverage: { testable: 2, covered: 1, untestable: 0, ratio: 0.5 },
      },
      {
        filePath: "specs/auth/spec.md",
        title: "Auth Spec",
        description: "auth stuff",
        coverage: { testable: 4, covered: 3, untestable: 1, ratio: 0.75 },
      },
    ]);

    expect(groups).toEqual([
      {
        key: "specs/auth",
        title: "Auth Spec",
        description: "auth stuff",
        coverage: { testable: 6, covered: 4, untestable: 1, ratio: 4 / 6 },
        files: [
          { filePath: "specs/auth/spec.md", title: "Auth Spec" },
          { filePath: "specs/auth/plan.md", title: "Plan" },
        ],
      },
    ]);
  });
});
