import { describe, it, expect } from "vitest";
import { testDeclarations, testTitleAt } from "./test-declarations.js";

const declaredTests = testDeclarations;
const titleOfTestAt = testTitleAt;

const SOURCE = [
  'import { describe, it, expect } from "vitest";',
  "",
  'describe("embeddingWarning", () => {',
  '  it("adds nothing after 2 failures, below the degraded threshold", () => {',
  "    expect(1).toBe(1);",
  "  });",
  "",
  "  test.skip(`redacts ${kind} secrets`, () => {",
  "    expect(2).toBe(2);",
  "  });",
  "});",
].join("\n");

describe("testDeclarations", () => {
  it("returns the it and test.skip titles with their lines 4 and 8, template placeholders as written", () => {
    expect(declaredTests(SOURCE)).toEqual([
      {
        name: "adds nothing after 2 failures, below the degraded threshold",
        line: 4,
      },
      { name: "redacts ${kind} secrets", line: 8 },
    ]);
  });
});

describe("testTitleAt", () => {
  it("returns the title declared on line 4 when the anchor is line 4", () => {
    expect(titleOfTestAt(SOURCE, 4)).toBe(
      "adds nothing after 2 failures, below the degraded threshold",
    );
  });

  it("returns the enclosing test's title when the anchor is line 9 inside its body", () => {
    expect(titleOfTestAt(SOURCE, 9)).toBe("redacts ${kind} secrets");
  });

  it("returns null when the anchor is line 3, above every test", () => {
    expect(titleOfTestAt(SOURCE, 3)).toBeNull();
  });
});
