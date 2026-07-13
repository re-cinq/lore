import { describe, it, expect } from "vitest";
import {
  buildReviewFixDescription,
  formatReviewFeedback,
} from "./review-feedback.js";
import type { ReviewComment } from "./project/pulls/pull-requests-port.js";

const comment = (over: Partial<ReviewComment>): ReviewComment => ({
  id: 1,
  path: "src/index.ts",
  line: 42,
  body: "Use a constant here",
  user: "lore-bot",
  created_at: "2026-06-01T10:00:00Z",
  ...over,
});

describe("buildReviewFixDescription", () => {
  it("names the PR and round when both are present", () => {
    expect(buildReviewFixDescription({ prNumber: 424, iteration: 1 })).toBe(
      "Address review feedback on PR #424 (round 1)",
    );
  });

  it("omits the round when iteration is zero", () => {
    expect(buildReviewFixDescription({ prNumber: 424, iteration: 0 })).toBe(
      "Address review feedback on PR #424",
    );
  });

  it("falls back to a generic description when the PR number is null", () => {
    expect(buildReviewFixDescription({ prNumber: null, iteration: 2 })).toBe(
      "Address review feedback (round 2)",
    );
  });
});

describe("formatReviewFeedback", () => {
  it("returns an empty string for no comments", () => {
    expect(formatReviewFeedback([])).toBe("");
  });

  it("renders a file:line bullet for a located comment", () => {
    expect(formatReviewFeedback([comment({})])).toBe(
      "- src/index.ts:42 — Use a constant here",
    );
  });

  it("renders a file-only bullet when the line is null", () => {
    expect(
      formatReviewFeedback([comment({ line: null, body: "Rename file" })]),
    ).toBe("- src/index.ts — Rename file");
  });

  it("trims comment bodies and joins multiple comments by newline", () => {
    const out = formatReviewFeedback([
      comment({ path: "a.ts", line: 1, body: "  first  " }),
      comment({ path: "b.ts", line: 2, body: "second" }),
    ]);
    expect(out).toBe("- a.ts:1 — first\n- b.ts:2 — second");
  });
});
