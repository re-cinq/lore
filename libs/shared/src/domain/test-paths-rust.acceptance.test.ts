import { describe, it, expect } from "vitest";
import { isTestFile } from "./test-paths.js";
import { classifyFile } from "./content-classify.js";

describe("T202 Rust #[test] classification", () => {
  const rustContentWithTest = `
    fn helper() {}

    #[test]
    fn test_helper() {
      assert!(true);
    }
  `;

  const rustProductionContent = `
    fn helper() {}
  `;

  it("identifies a Rust file containing the test attribute as a test file even if its name is not test-like", () => {
    // @ts-expect-error -- Testing broadened signature before it is implemented
    expect(isTestFile("src/lib.rs", rustContentWithTest)).toBe(true);
  });

  it("does not identify a regular Rust file without the test attribute as a test file", () => {
    // @ts-expect-error -- Testing broadened signature before it is implemented
    expect(isTestFile("src/lib.rs", rustProductionContent)).toBe(false);
  });

  it("receives the agreed classification as a test", () => {
    // @ts-expect-error -- Testing broadened signature before it is implemented
    expect(classifyFile("src/lib.rs", rustContentWithTest)).toBe("test");
  });

  it("does not misclassify production code", () => {
    // @ts-expect-error -- Testing broadened signature before it is implemented
    expect(classifyFile("src/lib.rs", rustProductionContent)).toBe("code");
  });
});
