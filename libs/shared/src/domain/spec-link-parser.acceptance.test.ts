import { describe, it, expect } from "vitest";
import { parseTestLinksInStatement } from "./spec-link-parser.js";

describe("spec-link-parser acceptance", () => {
  it("handles malformed unbalanced groups explicitly without silent coverage loss. ([validated by `handles malformed unbalanced groups explicitly without silent coverage loss`](specs/spec-test-coverage/spec.md#L427))", () => {
    const content = "The statement. ([validated by foo](src/a.test.ts#L1)";
    const out = parseTestLinksInStatement(content);

    expect(out).toEqual([
      {
        label: "validated by foo",
        path: "src/a.test.ts",
        line: 1,
        hash: null,
      },
    ]);
  });

  it("retains a valid dotted backtick label explicitly in an unbalanced group without silent coverage loss (Number.MAX_SAFE_INTEGER regression). ([validated by `retains a valid dotted backtick label explicitly in an unbalanced group without silent coverage loss (Number.MAX_SAFE_INTEGER regression)`](specs/spec-test-coverage/spec.md#L427))", () => {
    const content = `The statement. ([\`Runner.step\`](src/a.test.ts#L9007199254740991)`;
    const out = parseTestLinksInStatement(content);

    expect(out).toEqual([
      {
        label: "`Runner.step`",
        path: "src/a.test.ts",
        line: 9007199254740991,
        hash: null,
      },
    ]);
  });
});
