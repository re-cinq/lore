import { describe, it, expect } from "vitest";
import type { PullRef } from "../../outbound/project/pulls/pull-requests-port.js";
import {
  decideRecheck,
  decideReviewOnOpen,
  decideReviewOnReply,
  isBotActor,
  isReviewRequest,
  isTrustedReviewer,
  recheckDescription,
  reviewFeedback,
} from "./code-review-decisions.js";

const REPO = "re-cinq/lore";

function openPr(over: Partial<PullRef> = {}): PullRef {
  return {
    repo: REPO,
    number: 42,
    title: "feat",
    branch: "feature/x",
    state: "open",
    labels: [],
    url: "u",
    author: "alice",
    draft: false,
    headSha: "abc123",
    ...over,
  };
}

describe("code-review pure decisions", () => {
  it("isBotActor is true only for [bot] logins", () => {
    expect(isBotActor("lore-app[bot]")).toBe(true);
    expect(isBotActor("alice")).toBe(false);
  });

  it("isReviewRequest matches an @lore review keyword, not arbitrary chatter", () => {
    expect(
      [
        "@lore review please",
        "/lore review",
        "lore review this",
        "thanks, looks good",
      ].map(isReviewRequest),
    ).toEqual([true, true, true, false]);
  });

  it("decideReviewOnOpen starts only for an open, non-draft, human PR with auto-review on", () => {
    const decided = [
      { autoReview: true, pr: openPr() },
      { autoReview: false, pr: openPr() },
      { autoReview: true, pr: null },
      { autoReview: true, pr: openPr({ draft: true }) },
      { autoReview: true, pr: openPr({ author: "lore-app[bot]" }) },
    ].map((given) => decideReviewOnOpen(given).start);

    expect(decided).toEqual([true, false, false, false, false]);
  });

  it("decideReviewOnReply starts only for an open, non-draft PR with a human comment", () => {
    expect(
      decideReviewOnReply({
        autoReview: true,
        pr: openPr(),
        commentAuthor: "alice",
      }).start,
    ).toBe(true);
    expect(
      decideReviewOnReply({
        autoReview: true,
        pr: openPr(),
        commentAuthor: "lore-app[bot]",
      }).start,
    ).toBe(false);
  });
});

describe("reviewFeedback", () => {
  it("composes the review body with inline comments carrying ids and locations", () => {
    expect(
      reviewFeedback("please tighten this up", [
        {
          id: 11,
          path: "src/a.ts",
          line: 7,
          body: "guard the null case",
          user: "alice",
          created_at: "2026-07-23",
          review_id: 900,
        },
        {
          id: 12,
          path: "src/b.ts",
          line: null,
          body: "typo in the doc",
          user: "alice",
          created_at: "2026-07-23",
          review_id: 900,
        },
      ]),
    ).toEqual(
      "please tighten this up\n\nInline comments:\n" +
        "- inline comment 11 on src/a.ts:7: guard the null case\n" +
        "- inline comment 12 on src/b.ts: typo in the doc",
    );
  });

  it("returns an empty string for a review with neither body nor comments", () => {
    expect(reviewFeedback("", [])).toEqual("");
  });

  it("keeps the inline-comments header when the review has no body", () => {
    expect(
      reviewFeedback("", [
        {
          id: 11,
          path: "src/a.ts",
          line: 7,
          body: "guard the null case",
          user: "alice",
          created_at: "2026-07-23",
          review_id: 900,
        },
      ]),
    ).toEqual(
      "Inline comments:\n- inline comment 11 on src/a.ts:7: guard the null case",
    );
  });
});

describe("decideRecheck", () => {
  it("starts a re-check for new commits nobody is judging yet", () => {
    expect(
      decideRecheck({
        headSha: "bbb",
        openReviewShas: [],
        newCommitMessages: ["fix: guard the null"],
      }),
    ).toMatchObject({ start: true });
  });

  it("refuses a second pass on a sha a review is already judging", () => {
    expect(
      decideRecheck({
        headSha: "bbb",
        openReviewShas: ["bbb"],
        newCommitMessages: ["fix: guard the null"],
      }),
    ).toEqual({
      start: false,
      reason: "a review of this sha is already running",
    });
  });

  it("starts a pass while another sha is in flight, so a push after a rebase still gets a verdict", () => {
    expect(
      decideRecheck({
        headSha: "ccc",
        openReviewShas: ["bbb"],
        newCommitMessages: ["fix: the rebase"],
      }),
    ).toMatchObject({ start: true });
  });

  it("refuses the push that only carries the CI formatter's own commit", () => {
    expect(
      decideRecheck({
        headSha: "ccc",
        openReviewShas: [],
        newCommitMessages: ["style: prettier [skip ci]"],
      }),
    ).toEqual({ start: false, reason: "the new commits all skip CI" });
  });

  it("starts when a formatter commit rides along with a real one", () => {
    expect(
      decideRecheck({
        headSha: "ccc",
        openReviewShas: [],
        newCommitMessages: ["style: prettier [skip ci]", "fix: the null guard"],
      }),
    ).toMatchObject({ start: true });
  });

  it("starts when no verdict has judged this PR yet, where there are no known new commits to weigh", () => {
    expect(
      decideRecheck({
        headSha: "bbb",
        openReviewShas: [],
        newCommitMessages: [],
      }),
    ).toMatchObject({ start: true });
  });
});

describe("recheckDescription", () => {
  it("names the sha the last verdict judged and the range to read", () => {
    expect(
      recheckDescription("re-cinq/lore", 42, "feature/x", "abc123"),
    ).toEqual(
      "Re-check pull request #42 in re-cinq/lore (branch feature/x) after a new push. The last verdict judged abc123; read what changed since it with `git -C /workspace/target diff abc123..HEAD`, and judge only that.",
    );
  });

  it("asks for the whole PR when no verdict has judged it yet", () => {
    expect(recheckDescription("re-cinq/lore", 42, "feature/x")).toEqual(
      "Re-check pull request #42 in re-cinq/lore (branch feature/x) after a new push.",
    );
  });
});

describe("isTrustedReviewer", () => {
  it("trusts OWNER, MEMBER and COLLABORATOR", () => {
    expect(["OWNER", "MEMBER", "COLLABORATOR"].map(isTrustedReviewer)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("does not trust CONTRIBUTOR, NONE or an empty association", () => {
    expect(["CONTRIBUTOR", "NONE", ""].map(isTrustedReviewer)).toEqual([
      false,
      false,
      false,
    ]);
  });
});
