import { describe, it, expect } from "vitest";
import { isTestFile, normalizeTestName } from "./test-paths";

describe("isTestFile", () => {
  it.each([
    "mcp-server/src/local-runner.test.ts",
    "web-ui/src/lib/spec-summary.test.tsx",
    "agent/src/jobs/spec-test-linker.spec.ts",
    "api/handlers_test.py",
    "src/__tests__/router.ts",
    "pkg/store/store_test.go",
  ])("returns true for test path %s", (filePath) => {
    expect(isTestFile(filePath)).toBe(true);
  });

  it.each([
    "web-ui/src/lib/test-paths.ts",
    "mcp-server/src/routes.ts",
    "specs/local-task-runner/spec.md",
    "src/tested/handler.ts",
    "pkg/store/store.go",
  ])("returns false for non-test path %s", (filePath) => {
    expect(isTestFile(filePath)).toBe(false);
  });
});

describe("normalizeTestName", () => {
  it("lowercases, collapses whitespace and joins with a wedge", () => {
    expect(normalizeTestName("  GroupName ", "suppresses   within cooldown")).toBe(
      "groupname › suppresses within cooldown",
    );
  });

  it("omits an empty describe segment", () => {
    expect(normalizeTestName("", "claims pending task")).toBe("claims pending task");
  });

  it("returns identical keys for the same test described with differing whitespace", () => {
    expect(normalizeTestName("local runner", "claims task")).toBe(
      normalizeTestName("local   runner", "claims  task"),
    );
  });
});
