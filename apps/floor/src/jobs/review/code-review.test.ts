import { describe, it, expect } from "vitest";
import {
  createCodeReviewHandlers,
  isBotActor,
  isReviewRequest,
  routeTriagedComment,
  decideReviewOnOpen,
  decideReviewOnReply,
  type CodeReviewDeps,
  type CommentContext,
} from "./code-review.js";
import { AssemblyLines } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines.js";
import { InMemoryAssemblyLines } from "@re-cinq/lore-shared/project/assembly-lines/assembly-lines-memory.js";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";

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

function harness(pr: PullRef | null, autoReview = true) {
  const port = new InMemoryAssemblyLines();
  const comments: Array<{ number: number; body: string }> = [];
  const project = {
    pulls: {
      get: async () => pr,
      comment: async (number: number, body: string) => {
        comments.push({ number, body });
      },
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
    expect(decideReviewOnOpen({ autoReview: true, pr: openPr() }).start).toBe(true);
    expect(decideReviewOnOpen({ autoReview: false, pr: openPr() }).start).toBe(false);
    expect(decideReviewOnOpen({ autoReview: true, pr: null }).start).toBe(false);
    expect(
      decideReviewOnOpen({ autoReview: true, pr: openPr({ draft: true }) }).start,
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
      decideReviewOnReply({ autoReview: true, pr: openPr(), commentAuthor: "alice" }).start,
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
      { definitionName: "code-review", args: { pr_number: 42, mode: "review", head_sha: "abc123" } },
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
      { definitionName: "comment-triage", args: { comment_id: 7, in_reply_to_id: 5 } },
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

describe("onReviewSubmitted", () => {
  it("starts a code-review-reply line with the address intent", async () => {
    const { port, handlers } = harness(openPr());

    await handlers.onReviewSubmitted({ repo: REPO, pr_number: 42 });

    expect(port.rows).toMatchObject([
      { definitionName: "code-review-reply", args: { intent: "address" } },
    ]);
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
