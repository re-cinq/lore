import { describe, expect, it } from "vitest";
import type { Brief, Tools } from "@re-cinq/floor-station";
import type {
  PullReview,
  ReviewComment,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { readReviewHandle, type ReviewReadingPulls } from "./station.js";

const tools: Tools = {
  read: async () => Buffer.from(""),
  produce: async () => undefined,
  modelCall: async () => undefined,
  signal: new AbortController().signal,
};

function briefOf(needs: Record<string, string>): Brief {
  return { visitId: "v1", iteration: 1, needs };
}

function fakePulls(
  reviews: PullReview[],
  comments: ReviewComment[],
  requestedRepos: string[],
  readNumbers: number[],
) {
  const pulls: ReviewReadingPulls = {
    listReviews: async (prNumber) => {
      readNumbers.push(prNumber);

      return reviews;
    },
    listComments: async () => comments,
  };

  return {
    project: async (repo: string) => {
      requestedRepos.push(repo);

      return { pulls };
    },
  };
}

const submittedReview: PullReview = {
  id: 55,
  state: "CHANGES_REQUESTED",
  body: "Rename the helper",
  user: "alice",
  submitted_at: "2026-09-30T10:00:00Z",
};

const inlineOfReview55: ReviewComment = {
  id: 700,
  path: "src/a.ts",
  line: 3,
  body: "use a name",
  user: "alice",
  created_at: "2026-09-30T10:00:00Z",
  review_id: 55,
};

const inlineOfReview99: ReviewComment = {
  ...inlineOfReview55,
  id: 701,
  review_id: 99,
};

describe("readReviewHandle", () => {
  it("produces body plus inline comment 700 for review 55 on PR 412 of re-cinq/lore", async () => {
    const requestedRepos: string[] = [];
    const readNumbers: number[] = [];
    const handle = readReviewHandle(
      fakePulls(
        [submittedReview],
        [inlineOfReview55, inlineOfReview99],
        requestedRepos,
        readNumbers,
      ),
    );

    const report = await handle(
      briefOf({
        pr_url: "https://github.com/re-cinq/lore/pull/412",
        review_id: "55",
      }),
      tools,
    );

    expect(report).toEqual({
      outcome: "success",
      produced: {
        review_feedback:
          "Rename the helper\n\nInline comments:\n- inline comment 700 on src/a.ts:3: use a name",
      },
    });
    expect({ requestedRepos, readNumbers }).toEqual({
      requestedRepos: ["re-cinq/lore"],
      readNumbers: [412],
    });
  });

  it("produces the fallback text when review_id is empty", async () => {
    const handle = readReviewHandle(
      fakePulls([submittedReview], [inlineOfReview55], [], []),
    );

    const report = await handle(
      briefOf({
        pr_url: "https://github.com/re-cinq/lore/pull/412",
        review_id: "",
      }),
      tools,
    );

    expect(report).toEqual({
      outcome: "success",
      produced: { review_feedback: "changes requested in a submitted review" },
    });
  });

  it("rejects when pr_url is https://example.com/x", async () => {
    const handle = readReviewHandle(fakePulls([], [], [], []));

    await expect(
      handle(
        briefOf({ pr_url: "https://example.com/x", review_id: "1" }),
        tools,
      ),
    ).rejects.toThrow(
      new Error("not a GitHub pull request url: https://example.com/x"),
    );
  });
});
