import { createCodeReviewHandlers } from "./code-review-handlers.js";
import { describe, it, expect } from "vitest";
import {
  isBotActor,
  isReviewRequest,
  routeTriagedComment,
  reviewFeedback,
  decideRecheck,
  startRecheck,
  decideReviewOnOpen,
  recheckDescription,
  decideReviewOnReply,
  type CodeReviewDeps,
  type CommentContext,
} from "./code-review.js";
import { AssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs.js";
import { InMemoryAssemblyRuns } from "@re-cinq/lore-shared/project/assembly-runs/assembly-runs-memory.js";
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
    actor: "alice",
    ...over,
  };
}

function harness(
  pr: PullRef | null,
  { autoReview = true, reviewComments = [] }: HarnessOptions = {},
) {
  const port = new InMemoryAssemblyRuns();
  const comments: Array<{ number: number; body: string }> = [];
  const project = {
    pulls: {
      get: async () => pr,
      comment: async (number: number, body: string) => {
        comments.push({ number, body });
      },
      listComments: async () => reviewComments,
      listCommits: async () => [],
    },
    assemblyRuns: new AssemblyRuns(REPO, port),
  };
  const reclaimed: string[] = [];
  const deps: CodeReviewDeps = {
    project: async () => project,
    autoReview: async () => autoReview,
    uiUrl: () => "https://lore.example.com",
    cleanupToken: async (key: string) => {
      reclaimed.push(key);
    },
  };

  return {
    port,
    comments,
    reclaimed,
    handlers: createCodeReviewHandlers(deps),
  };
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
      args: { pr_number: 42, mode: "review", actor: "alice" },
    });
  });

  it("routes address to a code-review-reply line with the address intent + thread", () => {
    expect(routeTriagedComment("address", ctx())).toMatchObject({
      definition: "code-review-reply",
      args: {
        intent: "address",
        comment_id: 7,
        in_reply_to_id: 5,
        actor: "alice",
      },
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
        blueprintName: "code-review",
        args: {
          pr_number: 42,
          mode: "review",
          head_sha: "abc123",
          actor: "alice",
        },
      },
    ]);
    expect(comments[0]?.body).toContain(`/assembly-runs/${port.rows[0]?.id}`);
    expect(comments[0]?.body).toContain("@lore review");
  });

  it("starts a code-review-recheck line on a push to an already-reviewed PR", async () => {
    const { port, handlers } = harness(openPr());

    await new AssemblyRuns(REPO, port).start("code-review", {
      args: { pr_number: 42 },
    });

    await handlers.onTrigger({ repo: REPO, pr_number: 42 });

    expect(port.rows[1]?.blueprintName).toBe("code-review-recheck");
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

    expect(port.rows).toMatchObject([
      { blueprintName: "code-review", args: { actor: "alice" } },
    ]);
  });

  it("starts no line for a non-keyword comment while comment-triage is switched off", async () => {
    const { port, handlers } = harness(openPr());

    await handlers.onComment({
      repo: REPO,
      pr_number: 42,
      comment_id: 7,
      comment_author: "alice",
      comment_body: "ok, fix it",
      in_reply_to_id: 5,
    });

    expect(port.rows).toHaveLength(0);
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
      { blueprintName: "code-review-reply", args: { intent: "address" } },
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
    const { port, handlers } = harness(openPr(), {
      reviewComments: [
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
      ],
    });

    await handlers.onReviewSubmitted(submitted);

    expect(port.rows).toMatchObject([
      {
        blueprintName: "code-review-reply",
        args: { intent: "address", actor: "alice" },
      },
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
        blueprintName: "code-review-reply",
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
    const facade = new AssemblyRuns(REPO, port);
    const id = await facade.start("code-review", { args: { pr_number: 42 } });

    await handlers.onClose({ repo: REPO, pr_number: 42 });

    expect(await facade.getById(id)).toMatchObject({
      status: "finished",
      outcome: "pr_closed",
    });
  });

  it("leaves a feature-planning line parked on the same PR alone, not finished pr_closed like every other open line used to (line 7505be4d killed a feature this way)", async () => {
    const { port, handlers } = harness(openPr());
    const facade = new AssemblyRuns(REPO, port);
    const planning = await facade.start("feature-planning", {
      args: { pr_number: 42 },
    });

    await handlers.onClose({ repo: REPO, pr_number: 42 });

    expect(await facade.getById(planning)).toMatchObject({
      outcome: null,
    });
  });
});

describe("onTrigger re-check routing", () => {
  it("re-checks with the head sha and recheck mode and posts no per-push comment", async () => {
    const { port, comments, handlers } = harness(openPr());

    await new AssemblyRuns(REPO, port).start("code-review", {
      args: { pr_number: 42 },
    });

    await handlers.onTrigger({ repo: REPO, pr_number: 42 });

    expect(port.rows[1]).toMatchObject({
      blueprintName: "code-review-recheck",
      args: { pr_number: 42, mode: "recheck", head_sha: "abc123" },
    });
    expect(comments).toHaveLength(0);
  });

  it("skips the re-check on a bot-authored PR under the same loop guard as the first review", async () => {
    const { port, handlers } = harness(openPr({ author: "lore-app[bot]" }));

    await new AssemblyRuns(REPO, port).start("code-review", {
      args: { pr_number: 42 },
    });

    await handlers.onTrigger({ repo: REPO, pr_number: 42 });

    expect(port.rows).toHaveLength(1);
  });
});

describe("a PR closed while its review line is still running", () => {
  it("reclaims the closed line's token key so agent-secrets does not grow a key per PR — closing bypasses finishLine, so nothing else would ever free it (leaked keys once hit the 1MiB ceiling)", async () => {
    const h = harness(openPr({ state: "closed" }));
    const runId = await h.port.start({
      blueprintName: "code-review",
      repo: REPO,
      args: { pr_number: 42 },
    });

    await h.handlers.onClose({ repo: REPO, pr_number: 42 });

    expect(h.reclaimed).toEqual([runId]);
  });

  it("reclaims nothing when the PR carried no open review line", async () => {
    const h = harness(openPr({ state: "closed" }));

    await h.handlers.onClose({ repo: REPO, pr_number: 42 });

    expect(h.reclaimed).toEqual([]);
  });
});

describe("a forced review while one is already in flight", () => {
  it("posts the how-to comment once across two `@lore review` triggers, since start-or-JOIN returns the FIRST run's id both times", async () => {
    const h = harness(openPr());

    await h.handlers.onComment({
      repo: REPO,
      pr_number: 42,
      comment_id: 1,
      comment_author: "alice",
      comment_body: "@lore review",
    });
    await h.handlers.onComment({
      repo: REPO,
      pr_number: 42,
      comment_id: 2,
      comment_author: "alice",
      comment_body: "@lore review",
    });

    expect(
      h.comments.filter((c) => c.body.includes("Lore is reviewing this PR")),
    ).toHaveLength(1);
    expect(h.port.rows).toHaveLength(1);
  });
});

interface HarnessOptions {
  autoReview?: boolean;
  reviewComments?: ReviewComment[];
}

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

describe("startRecheck — the range it hands the pod", () => {
  function recheckHarness(opts: {
    lastJudged?: string;
    commits: Array<{ sha: string; message: string }>;
  }) {
    const started: Array<{
      blueprintName: string;
      args: Record<string, unknown>;
    }> = [];
    const project = {
      pulls: {
        get: async () => openPr({ headSha: "head9" }),
        comment: async () => {},
        listComments: async () => [],
        listCommits: async () => opts.commits,
      },
      assemblyRuns: {
        start: async (
          blueprintName: string,
          o: { args?: Record<string, unknown> },
        ) => {
          started.push({ blueprintName, args: o.args ?? {} });

          return "run-1";
        },
        findOpenBySubject: async () => null,
        findOpenByPr: async () => [],
        listForPr: async () =>
          opts.lastJudged ? [{ args: { head_sha: opts.lastJudged } }] : [],
        finishOpenByPr: async () => [],
        hasReviewedPr: async () => true,
      },
    } as unknown as Parameters<typeof startRecheck>[0];

    return { project, started };
  }

  it("names the judged sha when it is still on the branch", async () => {
    const { project, started } = recheckHarness({
      lastJudged: "old1",
      commits: [
        { sha: "old1", message: "feat: first" },
        { sha: "head9", message: "fix: second" },
      ],
    });

    await startRecheck(project, { repo: REPO, prNumber: 42, autoReview: true });

    expect(started[0]?.args.description).toContain(
      "The last verdict judged old1",
    );
  });

  it("names no sha after a rebase dropped the judged commit, so the pod never diffs against history the branch lost", async () => {
    const { project, started } = recheckHarness({
      lastJudged: "gone7",
      commits: [
        { sha: "new1", message: "feat: first, rebased" },
        { sha: "head9", message: "fix: second, rebased" },
      ],
    });

    await startRecheck(project, { repo: REPO, prNumber: 42, autoReview: true });

    expect(started).toHaveLength(1);
    expect(started[0]?.args.description).not.toContain(
      "The last verdict judged",
    );
  });
});
