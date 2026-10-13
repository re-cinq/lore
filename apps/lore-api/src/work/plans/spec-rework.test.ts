import { describe, it, expect } from "vitest";
import type { PlanLine } from "@re-cinq/lore-shared/project/plans/plan-run.js";
import {
  assertReworkable,
  gatherOpenReview,
  type SpecReviewReads,
} from "./spec-rework.js";

const PLAN = { id: "p1", status: "approved" };

const THREADS = [
  {
    id: "T_1",
    isResolved: false,
    isOutdated: false,
    comments: [{ databaseId: 41 }],
  },
  {
    id: "T_2",
    isResolved: true,
    isOutdated: false,
    comments: [{ databaseId: 42 }],
  },
];

const COMMENTS = [
  {
    id: 41,
    path: "specs/checkout/spec.md",
    line: 12,
    user: "ana",
    body: "FR2 contradicts the plan",
  },
  {
    id: 42,
    path: "specs/checkout/spec.md",
    line: 30,
    user: "ana",
    body: "typo",
  },
];

const REVIEWS = [
  { id: 9, state: "CHANGES_REQUESTED", body: "Split FR3.", user: "ana" },
  { id: 10, state: "APPROVED", body: "", user: "bob" },
];

const withReview = (reads: Partial<SpecReviewReads> = {}): SpecReviewReads => ({
  listReviewThreads: async () => THREADS as never,
  listComments: async () => COMMENTS as never,
  listReviews: async () => REVIEWS as never,
  ...reads,
});

function line(lineId: string, facts: Partial<PlanLine> = {}): PlanLine {
  return {
    lineId,
    status: "running",
    outcome: null,
    prNumber: 7,
    prUrl: "https://github.com/re-cinq/lore/pull/7",
    branch: "lore/feature-planning/faster-checkout-abcd1234",
    open: "merged",
    parkedAuthor: null,
    parkedMerged: { lineId, nodeId: "merged", iteration: 1 },
    merged: false,
    ...facts,
  };
}

describe("assertReworkable", () => {
  it("returns spec PR number 7 for an approved plan whose line waits on the PR", () => {
    expect(assertReworkable(PLAN, line("run-1"))).toBe(7);
  });

  it("refuses with 409 while the spec PR is not waiting for review", () => {
    expect(() =>
      assertReworkable(
        PLAN,
        line("run-1", { open: "push", parkedMerged: null }),
      ),
    ).toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 409 }),
        message: "the spec PR is not waiting for review",
      }),
    );
  });

  it("refuses with 409 a line that has no spec PR", () => {
    expect(() =>
      assertReworkable(PLAN, line("run-1", { prNumber: null, prUrl: null })),
    ).toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 409 }),
        message: "the line has no spec PR",
      }),
    );
  });

  it("refuses with 409 a plan that is not approved", () => {
    expect(() =>
      assertReworkable({ id: "p1", status: "draft" }, line("run-1")),
    ).toThrow(
      expect.objectContaining({
        output: expect.objectContaining({ statusCode: 409 }),
        message: "the plan is not approved",
      }),
    );
  });
});

describe("gatherOpenReview", () => {
  it("gathers spec PR #7's unresolved comment 41 and the review that requested changes", async () => {
    expect(await gatherOpenReview(withReview(), 7)).toEqual({
      pr_number: 7,
      reviews: [
        {
          id: 9,
          author: "ana",
          state: "CHANGES_REQUESTED",
          body: "Split FR3.",
        },
      ],
      comments: [
        {
          id: 41,
          path: "specs/checkout/spec.md",
          line: 12,
          author: "ana",
          body: "FR2 contradicts the plan",
        },
      ],
    });
  });

  it("refuses with 409 when every thread is resolved and no review said anything", async () => {
    const quiet = withReview({
      listReviewThreads: async () => [],
      listReviews: async () =>
        [{ id: 10, state: "APPROVED", body: "  ", user: "bob" }] as never,
    });

    await expect(gatherOpenReview(quiet, 7)).rejects.toMatchObject({
      output: { statusCode: 409 },
      message:
        "nothing on the spec PR is waiting for the writer: no unresolved comment and no review body",
    });
  });
});
