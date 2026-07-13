import { describe, it, expect } from "vitest";
import {
  createCodeReviewHandlers,
  isBotActor,
  decideReviewOnOpen,
  decideReviewOnReply,
  type CodeReviewDeps,
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
      isClosed: async () => pr?.state !== "open",
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
    expect(isBotActor("")).toBe(false);
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
      decideReviewOnOpen({ autoReview: true, pr: openPr({ state: "closed" }) })
        .start,
    ).toBe(false);
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

  it("decideReviewOnReply starts only for an open, non-draft PR with a human comment and auto-review on", () => {
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
    expect(
      decideReviewOnReply({
        autoReview: false,
        pr: openPr(),
        commentAuthor: "alice",
      }).start,
    ).toBe(false);
    expect(
      decideReviewOnReply({
        autoReview: true,
        pr: openPr({ state: "closed" }),
        commentAuthor: "alice",
      }).start,
    ).toBe(false);
    expect(
      decideReviewOnReply({
        autoReview: true,
        pr: openPr({ draft: true }),
        commentAuthor: "alice",
      }).start,
    ).toBe(false);
  });
});

describe("codeReviewOnOpen", () => {
  it("starts a code-review line in review mode and posts a linked started-comment", async () => {
    const { port, comments, handlers } = harness(openPr());

    await handlers.onOpen({ repo: REPO, pr_number: 42 });

    expect(port.rows).toMatchObject([
      {
        definitionName: "code-review",
        args: { pr_number: 42, mode: "review" },
      },
    ]);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toContain(`/assembly-lines/${port.rows[0]?.id}`);
  });

  it("does nothing when auto-review is off", async () => {
    const { port, comments, handlers } = harness(openPr(), false);

    await handlers.onOpen({ repo: REPO, pr_number: 42 });

    expect(port.rows).toHaveLength(0);
    expect(comments).toHaveLength(0);
  });

  it("skips a bot-authored PR (avoids double-review of Lore's own PRs)", async () => {
    const { port, handlers } = harness(openPr({ author: "lore-app[bot]" }));

    await handlers.onOpen({ repo: REPO, pr_number: 42 });

    expect(port.rows).toHaveLength(0);
  });
});

describe("codeReviewOnReply", () => {
  it("starts a reply-mode line for a human comment on an open PR", async () => {
    const { port, handlers } = harness(openPr());

    await handlers.onReply({
      repo: REPO,
      pr_number: 42,
      comment_id: 7,
      comment_author: "alice",
      comment_body: "please fix",
    });

    expect(port.rows).toMatchObject([
      {
        definitionName: "code-review",
        args: {
          pr_number: 42,
          mode: "reply",
          comment_id: 7,
          comment_body: "please fix",
        },
      },
    ]);
  });

  it("ignores the bot's own comment (loop guard)", async () => {
    const { port, handlers } = harness(openPr());

    await handlers.onReply({
      repo: REPO,
      pr_number: 42,
      comment_id: 8,
      comment_author: "lore-app[bot]",
      comment_body: "Lore review has started",
    });

    expect(port.rows).toHaveLength(0);
  });

  it("ignores a reply on a closed PR", async () => {
    const { port, handlers } = harness(openPr({ state: "closed" }));

    await handlers.onReply({
      repo: REPO,
      pr_number: 42,
      comment_id: 9,
      comment_author: "alice",
      comment_body: "late",
    });

    expect(port.rows).toHaveLength(0);
  });
});

describe("codeReviewOnClose", () => {
  it("finishes any open code-review lines for the PR", async () => {
    const { port, handlers } = harness(openPr());
    const facade = new AssemblyLines(REPO, port);
    const id = await facade.start("code-review", {
      args: { pr_number: 42, mode: "review" },
    });

    await handlers.onClose({ repo: REPO, pr_number: 42 });

    expect(await facade.getById(id)).toMatchObject({
      status: "finished",
      outcome: "pr_closed",
    });
  });
});
