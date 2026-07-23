import { describe, it, expect } from "vitest";
import {
  createCodeReviewHandlers,
  isBotActor,
  isReviewRequest,
  routeTriagedComment,
  reviewFeedback,
  decideReviewOnOpen,
  decideReviewOnReply,
  type CodeReviewDeps,
  type CommentContext,
} from "./code-review.js";
import { AssemblyLines } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines.js";
import { InMemoryAssemblyLines } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-memory.js";
import type {
  PullRef,
  ReviewComment,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

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

function ctx(over: Partial<CommentContext> = {}): CommentContext {
  return {
    repo: REPO,
    pr_number: 42,
    branch: "feature/x",
    head_sha: "abc123",
    comment_id: 7,
    comment_body: "ok, fix it",
    in_reply_to_id: 5,
    ...over,
  };
}

function harness(
  pr: PullRef | null,
  autoReview = true,
  reviewComments: ReviewComment[] = [],
) {
  const port = new InMemoryAssemblyLines();
  const comments: Array<{ number: number; body: string }> = [];
  const project = {
    pulls: {
      get: async () => pr,
      comment: async (number: number, body: string) => {
        comments.push({ number, body });
      },
      listComments: async () => reviewComments,
    },
    assemblyLines: new AssemblyLines(REPO, port),
  };
  const deps: CodeReviewDeps = {
    project: async () => project,
    autoReview: async () => autoReview,
    uiUrl: () => "https://lore.example.com",
  };

  return { port, comments, handlers: createCodeReviewHandlers(deps) };
}

describe("code-review pure decisions", () => {
  it("isBotActor is true only for [bot] logins", () => {
    expect(isBotActor("lore-app[bot]")).toBe(true);
    expect(isBotActor("alice")).toBe(false);
  });

  it("isReviewRequest matches an @lore review keyword, not arbitrary chatter", () => {
    expect(isReviewRequest("@lore review please")).toBe(true);
    expect(isReviewRequest("/lore review")).toBe(true);
    expect(isReviewRequest("lore review this")).toBe(true);
    expect(isReviewRequest("thanks, looks good")).toBe(false);
  });

  it("decideReviewOnOpen starts only for an open, non-draft, human PR with auto-review on", () => {
    expect(decideReviewOnOpen({ autoReview: true, pr: openPr() }).start).toBe(
      true,
    );
    expect(decideReviewOnOpen({ autoReview: false, pr: openPr() }).start).toBe(
      false,
    );
    expect(decideReviewOnOpen({ autoReview: true, pr: null }).start).toBe(
      false,
    );
    expect(
      decideReviewOnOpen({ autoReview: true, pr: openPr({ draft: true }) })
        .start,
    ).toBe(false);
    expect(
      decideReviewOnOpen({
        autoReview: true,
        pr: openPr({ author: "lore-app[bot]" }),
      }).start,
    ).toBe(false);
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

describe("routeTriagedComment", () => {
  it("routes review to a code-review line", () => {
    expect(routeTriagedComment("review", ctx())).toMatchObject({
      definition: "code-review",
      args: { pr_number: 42, mode: "review" },
    });
  });

  it("routes address to a code-review-reply line with the address intent + thread", () => {
    expect(routeTriagedComment("address", ctx())).toMatchObject({
      definition: "code-review-reply",
      args: { intent: "address", comment_id: 7, in_reply_to_id: 5 },
    });
  });

  it("routes answer to a code-review-reply line with the answer intent", () => {
    expect(routeTriagedComment("answer", ctx())).toMatchObject({
      definition: "code-review-reply",
      args: { intent: "answer" },
    });
  });

  it("routes ignore to nothing", () => {
    expect(routeTriagedComment("ignore", ctx())).toBeNull();
  });
});

describe("onTrigger", () => {
  it("starts a code-review line and posts a how-to started-comment", async () => {
    const { port, comments, handlers } = harness(openPr());

    await handlers.onTrigger({ repo: REPO, pr_number: 42 });

    expect(port.rows).toMatchObject([
      {
        definitionName: "code-review",
        args: { pr_number: 42, mode: "review", head_sha: "abc123" },
      },
    ]);
    expect(comments[0]?.body).toContain(`/assembly-lines/${port.rows[0]?.id}`);
    expect(comments[0]?.body).toContain("@lore review");
  });

  it("does not re-review a PR that already has a code-review line (first-review-only)", async () => {
    const { port, handlers } = harness(openPr());

    await new AssemblyLines(REPO, port).start("code-review", {
      args: { pr_number: 42 },
    });

    await handlers.onTrigger({ repo: REPO, pr_number: 42 });

    expect(port.rows).toHaveLength(1);
  });

  it("skips a draft PR", async () => {
    const { port, handlers } = harness(openPr({ draft: true }));

    await handlers.onTrigger({ repo: REPO, pr_number: 42 });

    expect(port.rows).toHaveLength(0);
  });
});

describe("onComment", () => {
  it("starts a code-review line directly on an @lore review keyword", async () => {
    const { port, handlers } = harness(openPr());

    await handlers.onComment({
      repo: REPO,
      pr_number: 42,
      comment_id: 7,
      comment_author: "alice",
      comment_body: "@lore review please",
    });

    expect(port.rows).toMatchObject([{ definitionName: "code-review" }]);
  });

  it("starts a comment-triage line for a non-keyword comment", async () => {
    const { port, handlers } = harness(openPr());

    await handlers.onComment({
      repo: REPO,
      pr_number: 42,
      comment_id: 7,
      comment_author: "alice",
      comment_body: "ok, fix it",
      in_reply_to_id: 5,
    });

    expect(port.rows).toMatchObject([
      {
        definitionName: "comment-triage",
        args: { comment_id: 7, in_reply_to_id: 5 },
      },
    ]);
  });

  it("ignores the bot's own comment (loop guard)", async () => {
    const { port, handlers } = harness(openPr());

    await handlers.onComment({
      repo: REPO,
      pr_number: 42,
      comment_id: 8,
      comment_author: "lore-app[bot]",
      comment_body: "Lore is reviewing",
    });

    expect(port.rows).toHaveLength(0);
  });
});

describe("onCommentTriaged", () => {
  it("starts the routed follow-up line for the action", async () => {
    const { port, handlers } = harness(openPr());

    await handlers.onCommentTriaged({ action: "address", context: ctx() });

    expect(port.rows).toMatchObject([
      { definitionName: "code-review-reply", args: { intent: "address" } },
    ]);
  });

  it("does nothing on an ignore action", async () => {
    const { port, handlers } = harness(openPr());

    await handlers.onCommentTriaged({ action: "ignore", context: ctx() });

    expect(port.rows).toHaveLength(0);
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
});

describe("onReviewSubmitted", () => {
  const submitted = {
    repo: REPO,
    pr_number: 42,
    review_id: 900,
    review_state: "changes_requested",
    review_author: "alice",
    review_body: "please tighten this up",
  };

  it("starts a code-review-reply line carrying the review body and its inline comments", async () => {
    const { port, handlers } = harness(openPr(), true, [
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
        id: 99,
        path: "src/old.ts",
        line: 1,
        body: "from an earlier review",
        user: "bob",
        created_at: "2026-07-01",
        review_id: 111,
      },
    ]);

    await handlers.onReviewSubmitted(submitted);

    expect(port.rows).toMatchObject([
      { definitionName: "code-review-reply", args: { intent: "address" } },
    ]);
    const description = String(port.rows[0]?.args?.description);

    expect(description).toContain("please tighten this up");
    expect(description).toContain("inline comment 11 on src/a.ts:7");
    expect(description).not.toContain("from an earlier review");
  });

  it("falls back to a generic description when the review carried no text", async () => {
    const { port, handlers } = harness(openPr());

    await handlers.onReviewSubmitted({
      ...submitted,
      review_id: null,
      review_body: "",
    });

    expect(port.rows).toMatchObject([
      {
        definitionName: "code-review-reply",
        args: { comment_body: "changes requested in a submitted review" },
      },
    ]);
  });

  it("ignores an approved review", async () => {
    const { port, handlers } = harness(openPr());

    await handlers.onReviewSubmitted({
      ...submitted,
      review_state: "approved",
    });

    expect(port.rows).toHaveLength(0);
  });

  it("ignores the bot's own submitted review (loop guard)", async () => {
    const { port, handlers } = harness(openPr());

    await handlers.onReviewSubmitted({
      ...submitted,
      review_author: "lore-app[bot]",
    });

    expect(port.rows).toHaveLength(0);
  });
});

describe("onClose", () => {
  it("finishes any open code-review lines for the PR", async () => {
    const { port, handlers } = harness(openPr());
    const facade = new AssemblyLines(REPO, port);
    const id = await facade.start("code-review", { args: { pr_number: 42 } });

    await handlers.onClose({ repo: REPO, pr_number: 42 });

    expect(await facade.getById(id)).toMatchObject({
      status: "finished",
      outcome: "pr_closed",
    });
  });
});
