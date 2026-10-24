import { describe, expect, it } from "vitest";
import type {
  PullReview,
  ReviewComment,
  ReviewThread,
} from "../../outbound/project/pulls/pull-requests-port.js";
import {
  loreReviewFeedbackOf,
  openLoreFindings,
  recheckHandOff,
} from "./lore-review.js";

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

function openThread(id: string, commentId: number): ReviewThread {
  return {
    id,
    isResolved: false,
    isOutdated: false,
    comments: [{ databaseId: commentId }],
  };
}

function resolvedThread(id: string, commentId: number): ReviewThread {
  return { ...openThread(id, commentId), isResolved: true };
}

describe("openLoreFindings", () => {
  it("returns only thread T1 when Lore's review 5 left T1 open and T2 resolved, and a person's review 6 left T3 open", () => {
    const reviews = [
      review(5, "4 findings <!-- lore-review-run: v1/1 -->"),
      review(6, "a person's review"),
    ];
    const comments = [comment(50, 5), comment(51, 5), comment(60, 6)];
    const threads = [
      openThread("T1", 50),
      resolvedThread("T2", 51),
      openThread("T3", 60),
    ];

    expect(openLoreFindings(reviews, comments, threads)).toEqual([
      { threadId: "T1", where: "src/a.ts:12", body: "fix 50" },
    ]);
  });
});

describe("recheckHandOff", () => {
  const asked = review(
    5,
    "### Lore review — Changes suggested\n\n**`src/a.ts:4`** — the null check is inverted\n\n<!-- lore-review-run: v1/1 -->",
  );

  it("hands the body of Lore's newest review 5 when it asked for changes and opened no thread", () => {
    const { brief, threadIds } = recheckHandOff([asked], [], []);

    expect({
      names: brief.includes("Lore's last review asked for changes"),
      carries: brief.includes("**`src/a.ts:4`** — the null check is inverted"),
      threadIds,
    }).toEqual({ names: true, carries: true, threadIds: [] });
  });

  it("hands nothing when Lore's newest review 6 approved after review 5 asked for changes", () => {
    const approved = review(
      6,
      "### Lore review — Approved\n\n<!-- lore-review-run: v2/1 -->",
    );

    expect(recheckHandOff([asked, approved], [], [])).toEqual({
      brief: "",
      threadIds: [],
    });
  });
});
