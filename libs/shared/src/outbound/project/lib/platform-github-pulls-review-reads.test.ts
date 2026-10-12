import { describe, expect, it } from "vitest";
import { toReviewComment } from "./platform-github-pulls-review-reads.js";

const reply = {
  id: 91,
  path: "src/a.ts",
  line: 12,
  body: "No, this still throws.",
  user: { login: "gedaiu" },
  created_at: "2026-10-02T09:00:00Z",
  pull_request_review_id: 99,
  in_reply_to_id: 70,
};

describe("toReviewComment", () => {
  it("carries comment 70 as the thread a reply of review 99 was written in", () => {
    expect(toReviewComment(reply)).toEqual({
      id: 91,
      path: "src/a.ts",
      line: 12,
      body: "No, this still throws.",
      user: "gedaiu",
      created_at: "2026-10-02T09:00:00Z",
      review_id: 99,
      in_reply_to_id: 70,
    });
  });

  it("reads a comment that opens its own thread as replying to nothing", () => {
    const { in_reply_to_id: _threadRoot, ...opening } = reply;

    expect(toReviewComment(opening).in_reply_to_id).toBeNull();
  });
});
