import { describe, it, expect } from "vitest";
import { summarizeStatement, windowRewrite } from "./impact-render.js";

describe("summarizeStatement — strips the inline validated-by parenthetical, regression #1077 (paragraph prose + 14 links unreadable raw)", () => {
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

describe("windowRewrite", () => {
  it("shows the change when it falls past a fixed truncation point", () => {
    const prefix = "x".repeat(300);
    const { before, after } = windowRewrite(
      `${prefix} drops by at least 80%.`,
      `${prefix} drops by at least 60%.`,
    );

    expect(before).toContain("80%");
    expect(after).toContain("60%");
  });

  it("elides the common head it skipped past", () => {
    const { before } = windowRewrite(
      `${"x".repeat(300)} old tail`,
      `${"x".repeat(300)} new tail`,
    );

    expect(before.startsWith("…")).toBe(true);
  });

  it("leaves a short pair untouched", () => {
    expect(windowRewrite("A MUST hold.", "A MUST fold.")).toEqual({
      before: "A MUST hold.",
      after: "A MUST fold.",
    });
  });
});
