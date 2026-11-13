import { describe, it, expect } from "vitest";
import {
  linksForStatements,
  parseTestLinksInStatement,
} from "./spec-link-parser.js";

describe("spec-link-parser acceptance", () => {
  it("handles malformed unbalanced groups explicitly without silent coverage loss, and ignores an unparenthesized trailing link after an unmatched paren", () => {
    const unbalanced = "The statement. ([validated by foo](src/a.test.ts#L1)";
    const unparenthesized =
      "An unmatched ( earlier in the statement [validated by foo](src/a.test.ts#L1)";

    expect({
      unbalanced: parseTestLinksInStatement(unbalanced),
      unparenthesized: parseTestLinksInStatement(unparenthesized),
    }).toEqual({
      unbalanced: [
        {
          label: "validated by foo",
          path: "src/a.test.ts",
          line: 1,
          hash: null,
        },
      ],
      unparenthesized: [],
    });
  });

  it("retains a valid dotted backtick label through linksForStatements without silent coverage loss (Number.MAX_SAFE_INTEGER regression)", () => {
    const content =
      "## Section\n\nThe statement. ([`Number.MAX_SAFE_INTEGER`](src/a.test.ts#L1))";
    const out = linksForStatements(content).flatMap((s) => s.testLinks);

    expect(out).toEqual([
      {
        label: "`Number.MAX_SAFE_INTEGER`",
        path: "src/a.test.ts",
        line: 1,
        hash: null,
      },
    ]);
  });
});
