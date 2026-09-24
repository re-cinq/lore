import { describe, it, expect } from "vitest";
import {
  renderSpecReview,
  specReviewFromArgs,
  specReviewIsEmpty,
  specReviewOf,
  specReviewResultSchema,
} from "./spec-review.js";

const comment = (id: number, body: string, path = "specs/a/spec.md") => ({
  id,
  path,
  line: 12,
  body,
  user: "loredana",
  created_at: "2026-09-24T18:00:00.000Z",
});

const READS = {
  threads: [
    {
      id: "T1",
      isResolved: false,
      isOutdated: false,
      comments: [{ databaseId: 11 }],
    },
    {
      id: "T2",
      isResolved: true,
      isOutdated: false,
      comments: [{ databaseId: 12 }],
    },
    {
      id: "T3",
      isResolved: false,
      isOutdated: true,
      comments: [{ databaseId: 13 }],
    },
  ],
  comments: [
    comment(11, " say at most five "),
    comment(12, "done already"),
    comment(13, "moved line, still open"),
    comment(14, "no thread known"),
  ],
  reviews: [
    {
      id: 5,
      state: "CHANGES_REQUESTED",
      body: " Do not suppress the model. ",
      user: "bogdan",
      submitted_at: "",
    },
    { id: 6, state: "APPROVED", body: "", user: "michael", submitted_at: "" },
  ],
};

describe("specReviewOf", () => {
  it("keeps comments 11 and 13 whose threads are unresolved (outdated too), drops the resolved 12 and the threadless 14, and keeps only reviews that said something", () => {
    expect(specReviewOf(261, READS)).toEqual({
      pr_number: 261,
      reviews: [
        {
          id: 5,
          author: "bogdan",
          state: "CHANGES_REQUESTED",
          body: "Do not suppress the model.",
        },
      ],
      comments: [
        {
          id: 11,
          path: "specs/a/spec.md",
          line: 12,
          author: "loredana",
          body: "say at most five",
        },
        {
          id: 13,
          path: "specs/a/spec.md",
          line: 12,
          author: "loredana",
          body: "moved line, still open",
        },
      ],
    });
  });
});

describe("specReviewFromArgs", () => {
  it("reads the review stored as JSON text or as an object, and answers null for none or for text that is not a review", () => {
    const review = specReviewOf(261, READS);

    expect([
      specReviewFromArgs({ spec_review: JSON.stringify(review) }),
      specReviewFromArgs({ spec_review: review }),
      specReviewFromArgs({}),
      specReviewFromArgs({ spec_review: "{}" }),
      specReviewFromArgs({ spec_review: "nope" }),
    ]).toEqual([review, review, null, null, null]);
  });
});

describe("renderSpecReview", () => {
  it("renders PR #261's review bodies then its open inline comments, each with the id the writer answers by", () => {
    expect(renderSpecReview(specReviewOf(261, READS)))
      .toBe(`## The spec review said

Spec PR #261 is under review. Every item below is open. Answer each one in spec-review-result.json by its id.

Reviews:
- review 5 by bogdan (CHANGES_REQUESTED): Do not suppress the model.

Inline comments:
- comment 11 on specs/a/spec.md:12 by loredana: say at most five
- comment 13 on specs/a/spec.md:12 by loredana: moved line, still open`);
  });

  it("is empty for a PR with nothing open", () => {
    expect(
      specReviewIsEmpty(
        specReviewOf(261, { threads: [], comments: [], reviews: [] }),
      ),
    ).toBe(true);
  });
});

describe("specReviewResultSchema", () => {
  it("accepts the writer's answer and fills the optional why and note", () => {
    expect(
      specReviewResultSchema.parse({
        plan_questions: [
          {
            slot: "intent",
            question: "Suppress the model, or let it phrase the answer?",
          },
        ],
        replies: [{ comment_id: 11, action: "addressed" }],
      }),
    ).toEqual({
      plan_questions: [
        {
          slot: "intent",
          question: "Suppress the model, or let it phrase the answer?",
          why: "",
        },
      ],
      replies: [{ comment_id: 11, action: "addressed", note: "" }],
    });
  });
});
