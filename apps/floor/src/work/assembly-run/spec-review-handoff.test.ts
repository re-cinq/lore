import { describe, it, expect } from "vitest";
import type { SpecReview } from "@re-cinq/lore-shared/review/spec-review.js";
import { withSpecReview } from "./spec-review-handoff.js";

const review: SpecReview = {
  pr_number: 42,
  reviews: [
    { id: 7, author: "gedaiu", state: "CHANGES_REQUESTED", body: "Too vague." },
  ],
  comments: [
    {
      id: 9001,
      path: "specs/x/spec.md",
      line: 12,
      author: "gedaiu",
      body: "Which service owns this?",
    },
  ],
};

describe("withSpecReview", () => {
  it("leaves the prompt untouched when the run carries no spec review", () => {
    expect(withSpecReview("Write the specs.", null)).toEqual(
      "Write the specs.",
    );
  });

  it("appends the review block with comment 9001 after the prompt", () => {
    const prompt = withSpecReview("Write the specs.", review);

    expect(prompt).toMatch(
      /^Write the specs\.\n\n## The spec review said\n[\s\S]*comment 9001 on specs\/x\/spec\.md:12 by gedaiu: Which service owns this\?\n$/,
    );
  });
});
