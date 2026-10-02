import { describe, it, expect } from "vitest";
import { parseReviewReply, parseThreadReplies } from "./review-reply.js";

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

const threads = (json: string): string =>
  `${block("Two comments handled.")}\n\n\`\`\`REVIEW_THREAD_REPLIES\n${json}\n\`\`\``;

describe("parseThreadReplies", () => {
  it("reads the reply to comment 88 as resolved and the one to comment 89 as open", () => {
    expect(
      parseThreadReplies(
        threads(
          '[{"comment_id": 88, "reply": "Renamed in a1b2c3d.", "resolved": true}, {"comment_id": 89, "reply": "It retries once, see retry.ts."}]',
        ),
      ),
    ).toEqual([
      { commentId: 88, reply: "Renamed in a1b2c3d.", resolved: true },
      { commentId: 89, reply: "It retries once, see retry.ts.", resolved: false },
    ]);
  });

  it("reads no thread replies from an output without the block", () => {
    expect(parseThreadReplies(block("Done."))).toEqual([]);
  });

  it("reads no thread replies from a block that is not JSON", () => {
    expect(parseThreadReplies(threads("comment 88: renamed"))).toEqual([]);
  });

  it("reads no thread replies when an entry names comment_id 0", () => {
    expect(
      parseThreadReplies(threads('[{"comment_id": 0, "reply": "Done."}]')),
    ).toEqual([]);
  });
});
