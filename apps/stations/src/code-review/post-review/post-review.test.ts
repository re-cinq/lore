import { describe, it, expect } from "vitest";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import {
  maybePostReview,
  partitionByHunks,
  postReview,
  reviewAlreadyPosted,
  reviewVisitMarker,
  type ReviewPoster,
  type ReviewVisit,
} from "./post-review.js";
import type { CommentablePositions } from "@re-cinq/lore-shared/review/diff-hunks.js";
import type { CreateReviewInput } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import type {
  ReviewFinding,
  ReviewOutput,
} from "@re-cinq/lore-shared/review/review-findings.js";

const visit: ReviewVisit = { visitId: "visit-9", iteration: 2 };
const marker = "<!-- lore-review-run: visit-9/2 -->";

function positions(...entries: Array<[string, number]>): CommentablePositions {
  const right = new Map<string, Set<number>>();

  for (const [path, line] of entries) {
    right.set(path, (right.get(path) ?? new Set<number>()).add(line));
  }

  return { right, left: new Map() };
}

function recorder(
  refuses: (input: CreateReviewInput) => string | null = () => null,
) {
  const calls: Array<{ number: number; input: CreateReviewInput }> = [];
  const comments: Array<{ number: number; body: string }> = [];
  const pulls: ReviewPoster = {
    createReview: async (number, input) => {
      const refusal = refuses(input);

      enforceTrue(refusal === null, Error, refusal ?? "");
      calls.push({ number, input });
    },
    comment: async (number, body) => {
      comments.push({ number, body });
    },
    getDiff: async () => "",
  };

  return { pulls, calls, comments };
}

const refusesEverything = () => "line must be part of the diff";

const finding = (over: Partial<ReviewFinding> = {}): ReviewFinding => ({
  path: "src/a.ts",
  line: 12,
  label: "issue",
  decoration: "blocking",
  subject: "null deref",
  ...over,
});

const changesRequested: ReviewOutput = {
  verdict: "changes_requested",
  summary: "one defect",
  findings: [finding({ line: 99 })],
};

const approvedBlock = `\`\`\`REVIEW_FINDINGS\n${JSON.stringify({ verdict: "approved", findings: [] })}\n\`\`\``;

describe("reviewVisitMarker", () => {
  it("renders visit-9 iteration 2 as an invisible HTML comment", () => {
    expect(reviewVisitMarker(visit)).toBe(marker);
  });
});

describe("partitionByHunks", () => {
  it("keeps findings on commentable lines inline and folds the rest into overflow", () => {
    const inHunk = finding({ path: "src/a.ts", line: 12 });
    const outOfHunk = finding({ path: "src/a.ts", line: 99 });
    const outOfDiff = finding({ path: "CLAUDE.md", line: 3 });

    expect(
      partitionByHunks(
        [inHunk, outOfHunk, outOfDiff],
        positions(["src/a.ts", 12]),
      ),
    ).toEqual({ inline: [inHunk], overflow: [outOfHunk, outOfDiff] });
  });
});

describe("postReview", () => {
  it("posts one REQUEST_CHANGES review with a rendered comment per commentable finding", async () => {
    const { pulls, calls } = recorder();
    const output: ReviewOutput = {
      verdict: "changes_requested",
      findings: [
        finding({ suggestion: "const x = y ?? 0;" }),
        {
          path: "src/b.ts",
          line: 3,
          side: "LEFT",
          label: "nit",
          subject: "rename",
        },
      ],
    };

    await postReview(pulls, 7, output, {
      positions: {
        right: new Map([["src/a.ts", new Set([12])]]),
        left: new Map([["src/b.ts", new Set([3])]]),
      },
      visit,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      number: 7,
      input: {
        event: "REQUEST_CHANGES",
        comments: [
          {
            path: "src/a.ts",
            line: 12,
            body: "**issue (blocking):** null deref\n\n```suggestion\nconst x = y ?? 0;\n```",
          },
          { path: "src/b.ts", line: 3, side: "LEFT", body: "**nit:** rename" },
        ],
      },
    });
  });

  it("folds the finding on line 99 into the body under the out-of-hunk heading and inlines only line 12", async () => {
    const { pulls, calls } = recorder();
    const output: ReviewOutput = {
      verdict: "changes_requested",
      findings: [
        finding({ line: 12, subject: "in-hunk issue" }),
        finding({ line: 99, subject: "out-of-hunk note" }),
      ],
    };

    await postReview(pulls, 7, output, {
      positions: positions(["src/a.ts", 12]),
      visit,
    });

    expect(calls[0]?.input.comments).toMatchObject([{ line: 12 }]);
    expect(calls[0]?.input.body).toContain(
      "### Notes on lines outside changed hunks",
    );
    expect(calls[0]?.input.body).toContain("out-of-hunk note");
  });

  it("keeps REQUEST_CHANGES and renders the finding in the body when GitHub rejects the inline comment", async () => {
    const { pulls, calls, comments } = recorder((input) =>
      input.comments.length > 0 ? "line must be part of the diff" : null,
    );

    const delivered = await postReview(pulls, 7, changesRequested, {
      positions: positions(["src/a.ts", 99]),
      visit,
    });

    expect(delivered).toMatchObject({ mode: "summary" });
    expect(calls.at(-1)?.input).toMatchObject({
      event: "REQUEST_CHANGES",
      comments: [],
    });
    expect(comments).toEqual([]);
  });

  it("posts a COMMENT review when GitHub rejects an approval on the author's own pull request", async () => {
    const { pulls, calls } = recorder((input) =>
      input.event === "COMMENT"
        ? null
        : "Can not approve your own pull request",
    );

    const delivered = await postReview(pulls, 7, changesRequested, {
      positions: positions(["src/a.ts", 99]),
      visit,
    });

    expect(delivered).toEqual({
      mode: "comment",
      error: "Can not approve your own pull request",
    });
    expect(calls.at(-1)?.input).toMatchObject({ event: "COMMENT" });
    expect(calls.at(-1)?.input.body).toContain("`lore/code-review` check");
  });

  it("posts one plain issue comment when every review shape is refused", async () => {
    const { pulls, calls, comments } = recorder(refusesEverything);

    const delivered = await postReview(pulls, 7, changesRequested, {
      positions: positions(["src/a.ts", 99]),
      visit,
    });

    expect(delivered).toEqual({
      mode: "fallback",
      error: "line must be part of the diff",
    });
    expect(calls).toEqual([]);
    expect(comments).toMatchObject([{ number: 7 }]);
  });

  it("starts the fallback comment with the note prefix the adapter never filters", async () => {
    const { pulls, comments } = recorder(refusesEverything);

    await postReview(
      pulls,
      7,
      { verdict: "approved", findings: [], summary: "s" },
      { positions: positions(), visit },
    );

    expect(comments[0]?.body).toMatch(/^_Inline placement/);
  });

  it("ends the review body with the identity line and then the hidden marker", async () => {
    const { pulls, calls } = recorder();

    await postReview(pulls, 7, changesRequested, {
      positions: positions(["src/a.ts", 99]),
      visit,
    });

    expect(calls[0]?.input.body).toMatch(
      /\n\n_Posted by floor, visit visit-9\._\n\n<!-- lore-review-run: visit-9\/2 -->$/,
    );
  });

  it("ends the fallback comment with the identity line and then the hidden marker", async () => {
    const { pulls, comments } = recorder(refusesEverything);

    await postReview(pulls, 7, changesRequested, {
      positions: positions(),
      visit,
    });

    expect(comments[0]?.body).toMatch(
      /\n\n_Posted by floor, visit visit-9\._\n\n<!-- lore-review-run: visit-9\/2 -->$/,
    );
  });

  it("submits an APPROVE review carrying the inline findings for an approved verdict", async () => {
    const { pulls, calls } = recorder();
    const output: ReviewOutput = {
      verdict: "approved",
      findings: [finding({ subject: "tiny nit" })],
    };

    await postReview(pulls, 7, output, {
      positions: positions(["src/a.ts", 12]),
      visit,
    });

    expect(calls[0]?.input).toMatchObject({
      event: "APPROVE",
      comments: [{ path: "src/a.ts", line: 12 }],
    });
  });
});

describe("maybePostReview", () => {
  it("posts when the output carries a REVIEW_FINDINGS block", async () => {
    const { pulls, calls } = recorder();

    expect(
      await maybePostReview(pulls, 7, approvedBlock, {
        positions: positions(),
        visit,
      }),
    ).toEqual({ mode: "inline" });
    expect(calls).toHaveLength(1);
  });

  it("posts a visible APPROVE review for a bare REVIEW_RESULT:APPROVED with no findings block", async () => {
    const { pulls, calls } = recorder();

    await maybePostReview(pulls, 7, "REVIEW_RESULT:APPROVED", {
      positions: positions(),
      visit,
    });

    expect(calls[0]?.input).toMatchObject({ event: "APPROVE", comments: [] });
    expect(calls[0]?.input.body).toContain("Approved");
  });

  it("posts nothing for CHANGES_REQUESTED without a findings block", async () => {
    const { pulls, calls } = recorder();

    expect(
      await maybePostReview(
        pulls,
        7,
        "REVIEW_RESULT:CHANGES_REQUESTED:but no block",
        { positions: positions(), visit },
      ),
    ).toBeNull();
    expect(calls).toEqual([]);
  });

  it("reports deduped without posting when this visit's marker is already on the PR", async () => {
    const { pulls, calls, comments } = recorder();
    const probing: ReviewPoster = {
      ...pulls,
      listReviews: async () => [
        {
          id: 1,
          state: "COMMENTED",
          body: `### Lore review\n\n${marker}`,
          user: "lore-agent[bot]",
          submitted_at: "2026-07-30T00:00:00Z",
        },
      ],
      listIssueComments: async () => [],
    };

    expect(
      await maybePostReview(probing, 7, approvedBlock, {
        positions: positions(),
        visit,
      }),
    ).toEqual({ mode: "deduped", marker });
    expect([...calls, ...comments]).toEqual([]);
  });

  it("skips the probe reads when the output parses to nothing", async () => {
    const probes: string[] = [];
    const probing: ReviewPoster = {
      ...recorder().pulls,
      listReviews: async () => {
        probes.push("reviews");

        return [];
      },
      listIssueComments: async () => {
        probes.push("comments");

        return [];
      },
    };

    await maybePostReview(probing, 7, "no block here", {
      positions: positions(),
      visit,
    });

    expect(probes).toEqual([]);
  });
});

describe("reviewAlreadyPosted", () => {
  const issueComment = (body: string) => ({
    id: 1,
    body,
    user: "lore-agent[bot]",
    created_at: "2026-07-30T00:00:00Z",
  });
  const probing = (comments: string[]): ReviewPoster => ({
    ...recorder().pulls,
    listReviews: async () => [],
    listIssueComments: async () => comments.map(issueComment),
  });

  it("finds this visit's marker in an existing issue comment", async () => {
    expect(
      await reviewAlreadyPosted(probing([`fallback\n\n${marker}`]), 7, marker),
    ).toBe(true);
  });

  it("reports not posted when the PR carries only visit-8's marker", async () => {
    const other = reviewVisitMarker({ visitId: "visit-8", iteration: 2 });

    expect(
      await reviewAlreadyPosted(probing([`review\n\n${other}`]), 7, marker),
    ).toBe(false);
  });

  it("reports not posted when the poster has no read surface", async () => {
    expect(await reviewAlreadyPosted(recorder().pulls, 7, marker)).toBe(false);
  });

  it("reports not posted when the probe throws", async () => {
    const pulls: ReviewPoster = {
      ...recorder().pulls,
      listReviews: async () => {
        throw new Error("API rate limited");
      },
      listIssueComments: async () => [],
    };

    expect(await reviewAlreadyPosted(pulls, 7, marker)).toBe(false);
  });
});
