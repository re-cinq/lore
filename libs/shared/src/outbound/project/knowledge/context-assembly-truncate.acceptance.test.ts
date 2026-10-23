import { describe, it, expect } from "vitest";
import { truncateText } from "./context-assembly-items.js";

describe("Context Assembly Truncation", () => {
  it("never slices mid-word or mid-sentence, defaulting to nearest prior paragraph boundary", () => {
    const text =
      "First paragraph ends here.\n\nSecond paragraph has a very long sentence that will be cut right in the middle of a word when we reach the maximum character limit for this test.";

    // maxTokens = 20 -> 80 chars
    // 80 chars is right in the middle of "...will be c|ut right..."
    const result = truncateText(text, 20);

    expect(result).toBe("First paragraph ends here.");
  });
});
