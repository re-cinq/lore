import { describe, expect, it } from "vitest";
import { clampPrTitle } from "./pr-title.js";

describe("clampPrTitle", () => {
  it("keeps a 20-character title as it is", () => {
    expect(clampPrTitle("Add the export button")).toBe("Add the export button");
  });

  it("folds line breaks and runs of spaces into single spaces", () => {
    expect(clampPrTitle("  Add the\n export   button ")).toBe(
      "Add the export button",
    );
  });

  it("cuts a 90-character title to 70 characters ending in an ellipsis", () => {
    const clamped = clampPrTitle("a".repeat(90));

    expect(clamped).toBe(`${"a".repeat(69)}…`);
  });
});
