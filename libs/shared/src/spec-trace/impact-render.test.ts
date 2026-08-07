import { describe, it, expect } from "vitest";
import { summarizeStatement } from "./impact-render.js";

/**
 * impact-render — turning a graph Statement into one readable table cell.
 *
 * Statement text is stored verbatim, INCLUDING the inline
 * `([validated by …](path#Lnn))` parenthetical the spec author wrote. Rendered
 * raw into a markdown table that produced cells carrying paragraph-length prose
 * followed by fourteen links (#1077), which is unreadable and, in a table, also
 * breaks on any pipe the statement happens to contain.
 */
describe("summarizeStatement", () => {
  it("strips the trailing validated-by parenthetical", () => {
    expect(
      summarizeStatement(
        "The widget MUST render on mount. ([validated by `a`](x.test.ts#L1), [`b`](y.test.ts#L2))",
      ),
    ).toEqual("The widget MUST render on mount.");
  });

  it("keeps a parenthetical that is prose rather than links", () => {
    expect(
      summarizeStatement("The widget MUST render (on mount, not on hover)."),
    ).toEqual("The widget MUST render (on mount, not on hover).");
  });

  it("collapses newlines so a statement cannot break out of a table row", () => {
    expect(summarizeStatement("First line.\nSecond line.")).toEqual(
      "First line. Second line.",
    );
  });

  it("escapes pipes so a statement cannot forge a table column", () => {
    expect(summarizeStatement("Accepts a|b as input.")).toEqual(
      "Accepts a\\|b as input.",
    );
  });

  it("truncates past the limit with an ellipsis", () => {
    expect(summarizeStatement("x".repeat(200))).toEqual(`${"x".repeat(119)}…`);
  });

  it("returns an empty string unchanged rather than an ellipsis", () => {
    expect(summarizeStatement("")).toEqual("");
  });
});
