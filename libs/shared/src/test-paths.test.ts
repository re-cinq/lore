import { describe, it, expect } from "vitest";
import { isTestFile, normalizeTestName } from "./test-paths.js";

describe("isTestFile", () => {
  it("recognizes test-path conventions across languages and rejects production paths", () => {
    const testPaths = [
      "mcp-server/src/local-runner.test.ts",
      "web-ui/src/lib/spec-summary.test.tsx",
      "agent/src/jobs/spec-test-linker.spec.ts",
      "src/__tests__/router.ts",
      "pkg/store/store_test.go",
      "api/tests/test_user.py",
      "api/user_test.py",
      "src/main/CalculatorTest.java",
      "src/test/CalculatorTests.kt",
      "src/store/store_test.rs",
      "spec/models/user_spec.rb",
      "Tests/CalculatorTests.cs",
      "tests/CalculatorTest.php",
    ];
    const productionPaths = [
      "shared/src/test-paths.ts",
      "mcp-server/src/routes.ts",
      "specs/local-task-runner/spec.md",
      "src/tested/handler.ts",
      "pkg/store/store.go",
      "app/foo.py",
      "src/Production.java",
      "src/foo.rs",
      "lib/foo.rb",
      "src/Service.cs",
      "src/Controller.php",
    ];

    expect({
      tests: testPaths.map(isTestFile),
      production: productionPaths.map(isTestFile),
    }).toEqual({
      tests: testPaths.map(() => true),
      production: productionPaths.map(() => false),
    });
  });
});

describe("normalizeTestName", () => {
  it("lowercases, collapses whitespace and joins with a wedge", () => {
    expect(
      normalizeTestName("  shouldSkipDrift ", "suppresses   within cooldown"),
    ).toBe("shouldskipdrift › suppresses within cooldown");
  });

  it("omits an empty describe segment", () => {
    expect(normalizeTestName("", "claims pending task")).toBe(
      "claims pending task",
    );
  });

  it("returns identical keys for the same test described with differing whitespace", () => {
    expect(normalizeTestName("local runner", "claims task")).toBe(
      normalizeTestName("local   runner", "claims  task"),
    );
  });
});
