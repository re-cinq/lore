import { describe, expect, it } from "vitest";
import type {
  PullReview,
  ReviewComment,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import {
  feedbackOf,
  inlineCommentsOf,
  parseReviewId,
  reviewBodyOf,
} from "./read-review.js";

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
    state: "CHANGES_REQUESTED",
    body,
    user: "alice",
    submitted_at: "2026-09-30T10:00:00Z",
  };
}

describe("parseReviewId", () => {
  it("returns 991 for text 991", () => {
    expect(parseReviewId("991")).toBe(991);
  });

  it("returns null for empty text", () => {
    expect(parseReviewId("")).toBeNull();
  });
});

describe("reviewBodyOf", () => {
  it("returns the body of review 2 among reviews 1 and 2", () => {
    expect(reviewBodyOf([review(1, "first"), review(2, "second")], 2)).toBe(
      "second",
    );
  });

  it("returns empty text when no review has id 5", () => {
    expect(reviewBodyOf([review(1, "first")], 5)).toBe("");
  });

  it("returns empty text when the review id is null", () => {
    expect(reviewBodyOf([review(1, "first")], null)).toBe("");
  });
});

describe("inlineCommentsOf", () => {
  it("keeps only comments of review 9 among comments of reviews 9 and 4", () => {
    expect(
      inlineCommentsOf([comment(1, 9), comment(2, 4), comment(3, 9)], 9).map(
        (found) => found.id,
      ),
    ).toEqual([1, 3]);
  });

  it("returns none when the review id is null", () => {
    expect(inlineCommentsOf([comment(1, null)], null)).toEqual([]);
  });
});

describe("feedbackOf", () => {
  it("joins body Please fix and inline comment 1 into one text", () => {
    expect(feedbackOf("Please fix", [comment(1, 9)])).toBe(
      "Please fix\n\nInline comments:\n- inline comment 1 on src/a.ts:12: fix 1",
    );
  });

  it("returns the fallback when body is blank and there are no inline comments", () => {
    expect(feedbackOf("  ", [])).toBe(
      "changes requested in a submitted review",
    );
  });
});
