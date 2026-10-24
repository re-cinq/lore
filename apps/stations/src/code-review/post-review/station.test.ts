import { describe, it, expect } from "vitest";
import type { Brief, Tools } from "@re-cinq/floor-station";
import type { CheckRunInput } from "@re-cinq/lore-shared/project/lib/github-port.js";
import type {
  CreateReviewInput,
  PullReview,
  ReviewComment,
  ReviewThread,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { enforceTrue } from "@re-cinq/lore-shared/lib/enforce.js";
import { postReviewHandle, type ReviewProject } from "./station.js";

const prUrl = "https://github.com/re-cinq/lore/pull/412";

const changesRequestedOutput = [
  "Looked at the diff.",
  "```REVIEW_FINDINGS",
  JSON.stringify({
    verdict: "changes_requested",
    findings: [
      { path: "src/a.ts", line: 12, label: "issue", subject: "null deref" },
      { path: "src/b.ts", line: 3, label: "nit", subject: "rename" },
    ],
  }),
  "```",
  "REVIEW_RESULT:CHANGES_REQUESTED:null deref",
].join("\n");

const brief = (needs: Record<string, string> = {}): Brief => ({
  visitId: "visit-9",
  iteration: 1,
  needs: { pr_url: prUrl, ...needs },
});

const toolsReading = (output: string): Tools => ({
  read: async () => Buffer.from(output),
  produce: async () => undefined,
  modelCall: async () => undefined,
  signal: new AbortController().signal,
});

interface FakeOverrides {
  requiredApprovals?: number;
  earlierReviews?: PullReview[];
  inlineComments?: ReviewComment[];
  threads?: ReviewThread[];
}

function fakeProject(
  refusal?: string,
  model?: string,
  {
    requiredApprovals = 0,
    earlierReviews = [],
    inlineComments = [],
    threads = [],
  }: FakeOverrides = {},
) {
  const reviews: CreateReviewInput[] = [];
  const comments: string[] = [];
  const checks: CheckRunInput[] = [];
  const repos: string[] = [];
  const ruleReads: string[] = [];
  const steps: string[] = [];
  const resolved: string[] = [];

  const project: ReviewProject = {
    pulls: {
      createReview: async (_number: number, input: CreateReviewInput) => {
        enforceTrue(refusal === undefined, Error, refusal ?? "");
        reviews.push(input);
        steps.push(`review:${input.event}`);
      },
      comment: async (_number: number, body: string) => {
        enforceTrue(refusal === undefined, Error, refusal ?? "");
        comments.push(body);
      },
      getDiff: async () => "",
      get: async () => ({
        headSha: "livesha",
        baseBranch: "main",
      }),
      getBranchRule: async (branch: string) => {
        ruleReads.push(branch);

        return {
          requiredApprovals,
          codeOwnersReview: false,
          requiredChecks: [],
        };
      },
      listReviews: async () => [
        ...earlierReviews,
        ...reviews.map((review) => ({
          id: 1,
          user: "lore",
          state: review.event,
          body: review.body ?? "",
          submitted_at: "2026-10-13T00:00:00Z",
        })),
      ],
      listComments: async () => inlineComments,
      listReviewThreads: async () => threads,
      resolveReviewThread: async (threadId: string) => {
        resolved.push(threadId);
      },
      listIssueComments: async () =>
        comments.map((body) => ({
          id: 1,
          user: "lore",
          body,
          created_at: "2026-10-13T00:00:00Z",
        })),
    },
    upsertCheckRun: async (input: CheckRunInput) => {
      checks.push(input);
    },
  };
  const deps = {
    project: async (repo: string) => {
      repos.push(repo);

      return project;
    },
    reviewModel: async () => model,
  };

  return {
    deps,
    reviews,
    comments,
    checks,
    repos,
    ruleReads,
    steps,
    resolved,
  };
}

describe("postReviewHandle", () => {
  it("creates the review, upserts the neutral check and reports success with the summary and url", async () => {
    const { deps, reviews, checks } = fakeProject();

    const report = await postReviewHandle(deps)(
      brief({ head_sha: "abc123" }),
      toolsReading(changesRequestedOutput),
    );

    expect(report).toEqual({
      outcome: "success",
      produced: {
        review_summary: "Changes requested, 2 findings",
        review_url: prUrl,
      },
    });
    expect(reviews).toMatchObject([{ event: "REQUEST_CHANGES" }]);
    expect(checks).toMatchObject([
      {
        headSha: "abc123",
        name: "lore/code-review",
        status: "completed",
        conclusion: "neutral",
      },
    ]);
  });

  it("looks the head sha up on the pull request when the brief carries none", async () => {
    const { deps, checks } = fakeProject();

    await postReviewHandle(deps)(
      brief(),
      toolsReading("REVIEW_RESULT:APPROVED"),
    );

    expect(checks).toMatchObject([
      { headSha: "livesha", conclusion: "success" },
    ]);
  });

  it("opens the repository re-cinq/lore named by the pull request url", async () => {
    const { deps, repos } = fakeProject();

    await postReviewHandle(deps)(
      brief(),
      toolsReading("REVIEW_RESULT:APPROVED"),
    );

    expect(repos).toEqual(["re-cinq/lore"]);
  });

  it("reads the review out of an NDJSON result envelope", async () => {
    const { deps, reviews } = fakeProject();
    const envelope = JSON.stringify({
      type: "result",
      is_error: false,
      result: changesRequestedOutput,
    });

    await postReviewHandle(deps)(brief(), toolsReading(envelope));

    expect(reviews).toHaveLength(1);
  });

  it("names gemini-3.1-pro-preview in the review body when the floor answers it", async () => {
    const { deps, reviews } = fakeProject(undefined, "gemini-3.1-pro-preview");

    await postReviewHandle(deps)(
      brief(),
      toolsReading("REVIEW_RESULT:APPROVED"),
    );

    expect(reviews[0]?.body).toContain(
      "_Reviewed by `gemini-3.1-pro-preview`_",
    );
  });

  it("names no reviewer in the review body when the floor answers no model", async () => {
    const { deps, reviews } = fakeProject();

    await postReviewHandle(deps)(
      brief(),
      toolsReading("REVIEW_RESULT:APPROVED"),
    );

    expect(reviews[0]?.body).not.toContain("Reviewed by");
  });

  it("throws when every review shape and the plain comment are refused", async () => {
    const { deps } = fakeProject("Forbidden");

    await expect(
      postReviewHandle(deps)(brief(), toolsReading(changesRequestedOutput)),
    ).rejects.toThrow(new Error("Forbidden"));
  });

  it("throws when the output has no verdict", async () => {
    const { deps } = fakeProject();

    await expect(
      postReviewHandle(deps)(brief(), toolsReading("the agent rambled")),
    ).rejects.toThrow(
      new Error(`no review verdict in the output for ${prUrl}`),
    );
  });

  it("throws when the pr_url is not a pull request", async () => {
    const { deps } = fakeProject();

    await expect(
      postReviewHandle(deps)(
        brief({ pr_url: "https://github.com/re-cinq/lore" }),
        toolsReading(changesRequestedOutput),
      ),
    ).rejects.toThrow(
      new Error(
        "not a GitHub pull request url: https://github.com/re-cinq/lore",
      ),
    );
  });
});

describe("Feature Specification: Lore merges on protected repos, and every PR knows what blocks it", () => {
  describe("Code review posts its verdict and never arms auto-merge: the auto-merge loop gives the approval that counts and arms the merge.", () => {
    it("reads the branch rule of the base branch main", async () => {
      const { deps, ruleReads } = fakeProject();

      await postReviewHandle(deps)(
        brief(),
        toolsReading("REVIEW_RESULT:APPROVED"),
      );

      expect(ruleReads).toEqual(["main"]);
    });

    it("given a branch requiring approval, when review approves, then it posts a comment review and arms nothing", async () => {
      const { deps, reviews, steps } = fakeProject(undefined, undefined, {
        requiredApprovals: 1,
      });

      await postReviewHandle(deps)(
        brief(),
        toolsReading("REVIEW_RESULT:APPROVED"),
      );

      expect({ events: reviews.map((r) => r.event), steps }).toEqual({
        events: ["COMMENT"],
        steps: ["review:COMMENT"],
      });
    });

    it("given an unprotected branch, when review approves, then it submits APPROVE", async () => {
      const { deps, reviews } = fakeProject(undefined, undefined, {
        requiredApprovals: 0,
      });

      await postReviewHandle(deps)(
        brief(),
        toolsReading("REVIEW_RESULT:APPROVED"),
      );

      expect(reviews).toMatchObject([{ event: "APPROVE" }]);
    });

    it("given a re-run on the same PR state, when review completes, then it posts the review once", async () => {
      const { deps, reviews } = fakeProject(undefined, undefined, {
        requiredApprovals: 1,
      });
      const handle = postReviewHandle(deps);

      await handle(
        brief({ head_sha: "abc123" }),
        toolsReading("REVIEW_RESULT:APPROVED"),
      );
      await handle(
        brief({ head_sha: "abc123" }),
        toolsReading("REVIEW_RESULT:APPROVED"),
      );

      expect(reviews).toHaveLength(1);
    });
  });
});

describe("Lore settles its own earlier findings once it approves", () => {
  const earlier = {
    earlierReviews: [
      {
        id: 5,
        state: "COMMENTED",
        body: "4 findings <!-- lore-review-run: visit-1/1 -->",
        user: "lore",
        submitted_at: "2026-10-12T00:00:00Z",
      },
      {
        id: 6,
        state: "COMMENTED",
        body: "a person's review",
        user: "alice",
        submitted_at: "2026-10-12T01:00:00Z",
      },
    ],
    inlineComments: [
      {
        id: 50,
        path: "src/a.ts",
        line: 4,
        body: "the null check is inverted",
        user: "lore",
        created_at: "2026-10-12T00:00:00Z",
        review_id: 5,
      },
      {
        id: 60,
        path: "src/a.ts",
        line: 9,
        body: "why this name?",
        user: "alice",
        created_at: "2026-10-12T01:00:00Z",
        review_id: 6,
      },
    ],
    threads: [
      {
        id: "T-lore",
        isResolved: false,
        isOutdated: false,
        comments: [{ databaseId: 50 }],
      },
      {
        id: "T-alice",
        isResolved: false,
        isOutdated: false,
        comments: [{ databaseId: 60 }],
      },
    ],
  };

  it("resolves thread T-lore of Lore's earlier review and leaves T-alice open when the re-check approves", async () => {
    const { deps, resolved } = fakeProject(undefined, undefined, earlier);

    await postReviewHandle(deps)(
      brief(),
      toolsReading("REVIEW_RESULT:APPROVED"),
    );

    expect(resolved).toEqual(["T-lore"]);
  });

  it("resolves no thread when the re-check asks for changes again", async () => {
    const { deps, resolved } = fakeProject(undefined, undefined, earlier);

    await postReviewHandle(deps)(brief(), toolsReading(changesRequestedOutput));

    expect(resolved).toEqual([]);
  });
});
