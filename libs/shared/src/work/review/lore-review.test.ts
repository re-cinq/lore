import { describe, expect, it } from "vitest";
import type {
  PullReview,
  ReviewComment,
} from "../../outbound/project/pulls/pull-requests-port.js";
import { loreReviewFeedbackOf } from "./lore-review.js";

function comment(id: number, reviewId: number | null): ReviewComment {
  return {
    id,
    path: "src/a.ts",
    line: 12,
    body: `fix ${id}`,
    user: "alice",
    created_at: "2026-09-30T10:00:00Z",
    review_id: reviewId,
  };
}

function review(id: number, body: string): PullReview {
  return {
    id,
    state: "COMMENTED",
    body,
    user: "lore",
    submitted_at: "2026-09-30T10:00:00Z",
  };
}

describe("loreReviewFeedbackOf", () => {
  it("returns review 3's body and its inline comment 11 when 3 is the newest review Lore posted", () => {
    const reviews = [
      review(1, "Old findings <!-- lore-review-run: v1/1 -->"),
      review(3, "New findings <!-- lore-review-run: v2/1 -->"),
      review(4, "a person's review"),
    ];
    const comments = [comment(10, 1), comment(11, 3), comment(12, 4)];

    expect(loreReviewFeedbackOf(reviews, comments)).toBe(
      "New findings <!-- lore-review-run: v2/1 -->\n\nInline comments:\n- inline comment 11 on src/a.ts:12: fix 11",
    );
  });

  it("returns empty text when Lore posted no review", () => {
    expect(loreReviewFeedbackOf([review(4, "a person's review")], [])).toBe("");
  });
});
