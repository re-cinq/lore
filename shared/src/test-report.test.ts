import { describe, it, expect } from "vitest";
import { parseTestDescriptors, parseRunResult } from "./test-report.js";

describe("parseTestDescriptors", () => {
  it("parses a descriptor carrying every field", () => {
    const result = parseTestDescriptors([
      {
        id: "mcp-server/src/local-runner.test.ts::claims pending task",
        name: "claims pending task before GKE picks it up",
        file: "mcp-server/src/local-runner.test.ts",
        startLine: 88,
        endLine: 121,
        spec: "specs/local-task-runner/spec.md#14",
        passed: true,
      },
    ]);
    expect(result).toEqual([
      {
        id: "mcp-server/src/local-runner.test.ts::claims pending task",
        name: "claims pending task before GKE picks it up",
        file: "mcp-server/src/local-runner.test.ts",
        startLine: 88,
        endLine: 121,
        spec: "specs/local-task-runner/spec.md#14",
        passed: true,
      },
    ]);
  });

  it("omits optional fields a descriptor does not declare", () => {
    const [descriptor] = parseTestDescriptors([
      { id: "pkg/store_test.go::TestClaim", name: "TestClaim", file: "pkg/store_test.go" },
    ]);
    expect(descriptor).toEqual({
      id: "pkg/store_test.go::TestClaim",
      name: "TestClaim",
      file: "pkg/store_test.go",
    });
  });

  it.each(["id", "name", "file"])("throws when the required %s is missing", (field) => {
    const valid = { id: "a::b", name: "b", file: "a" } as Record<string, unknown>;
    delete valid[field];
    expect(() => parseTestDescriptors([valid])).toThrow(new RegExp(field));
  });
});

describe("parseRunResult", () => {
  it("parses passed + a list of covered chunks", () => {
    const result = parseRunResult({
      passed: false,
      covered: [{ file: "mcp-server/src/local-runner.ts", startLine: 42, endLine: 58 }],
    });
    expect(result).toEqual({
      passed: false,
      covered: [{ file: "mcp-server/src/local-runner.ts", startLine: 42, endLine: 58 }],
    });
  });

  it("throws when a covered chunk is missing its line bounds", () => {
    expect(() =>
      parseRunResult({ passed: true, covered: [{ file: "x.ts", startLine: 5 }] }),
    ).toThrow(/endLine/);
  });
});
