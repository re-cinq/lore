import { describe, it, expect } from "vitest";
import { truncateText } from "./context-assembly-items.js";

describe("truncateText paragraph boundary", () => {
  it("truncates at paragraph boundary even when it is below 50% of the character limit", () => {
    // "\n\n" at char 2; maxChars = 20; 2/20 = 10% — the old 50% guard wrongly discards this boundary
    const result = truncateText("A.\n\n" + "B".repeat(30), 5);

    expect(result).toBe("A.");
  });
});
