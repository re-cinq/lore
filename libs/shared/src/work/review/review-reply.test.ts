import { describe, it, expect } from "vitest";
import { parseReviewReply } from "./review-reply.js";

const block = (body: string): string =>
  `Sure thing.\n\n\`\`\`REVIEW_REPLY\n${body}\n\`\`\`\n\nREVIEW_RESULT:APPROVED`;

describe("parseReviewReply", () => {
  it("returns the trimmed body of a reply block", () => {
    expect(
      parseReviewReply(block("Fixed in a1b2c3d — the guard is now first.")),
    ).toBe("Fixed in a1b2c3d — the guard is now first.");
  });

  it("preserves multi-line markdown inside the block", () => {
    const body = "Two things:\n- done the guard\n- left the naming as-is";

    expect(parseReviewReply(block(body))).toBe(body);
  });

  it("returns null when no reply block is present", () => {
    expect(parseReviewReply("REVIEW_RESULT:APPROVED")).toBeNull();
  });

  it("returns null for an empty reply block", () => {
    expect(parseReviewReply("```REVIEW_REPLY\n   \n```")).toBeNull();
  });
});
