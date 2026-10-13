import { describe, it, expect } from "vitest";
import type { Brief, Tools } from "@re-cinq/floor-station";
import type { CheckRunInput } from "@re-cinq/lore-shared/project/lib/github-port.js";
import type { CreateReviewInput } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
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

function fakeProject(
  refusal?: string,
  model?: string,
  overrides?: {
    branchRule?: any;
    settings?: any;
  },
) {
  const reviews: CreateReviewInput[] = [];
  const comments: string[] = [];
  const checks: CheckRunInput[] = [];
  const repos: string[] = [];
  const autoMergeCalls: any[] = [];
  const auditRows: any[] = [];

  const project: any = {
    pulls: {
      createReview: async (_number: number, input: CreateReviewInput) => {
        enforceTrue(refusal === undefined, Error, refusal ?? "");
        reviews.push(input);
      },
      comment: async (_number: number, body: string) => {
        enforceTrue(refusal === undefined, Error, refusal ?? "");
        comments.push(body);
      },
      getDiff: async () => "",
      get: async () => ({
        headSha: "livesha",
        branch: "main",
        nodeId: "PR_kw_test",
      }),
      enableAutoMerge: async (nodeId: string, method: string) => {
        autoMergeCalls.push({ nodeId, method });
      },
      listReviews: async () => reviews.map((r) => ({ body: r.body || "" })),
      listIssueComments: async () => comments.map((c) => ({ body: c })),
    },
    upsertCheckRun: async (input: CheckRunInput) => {
      checks.push(input);
    },
    getBranchRule: async () =>
      overrides?.branchRule ?? { requiresApprovals: 0 },
    getSettings: async () =>
      overrides?.settings ?? { auto_merge: { approver: "none" } },
    writeAuditRow: async (row: any) => {
      auditRows.push(row);
    },
  };
  const deps = {
    project: async (repo: string) => {
      repos.push(repo);

      return project as ReviewProject;
    },
    reviewModel: async () => model,
  };

  return { deps, reviews, comments, checks, repos, autoMergeCalls, auditRows };
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
  describe("Lore passes `mergeMethod: SQUASH` to `enablePullRequestAutoMerge`, the method the automerge label workflow already uses, so the switch changes nothing about history or CI.", () => {
    it("given a branch requiring approval, when review completes, then it calls enableAutoMerge with SQUASH and writes an audit row", async () => {
      const { deps, autoMergeCalls, auditRows } = fakeProject(
        undefined,
        undefined,
        {
          branchRule: { requiresApprovals: 1 },
        },
      );

      await postReviewHandle(deps)(
        brief(),
        toolsReading("REVIEW_RESULT:APPROVED"),
      );

      expect(autoMergeCalls).toMatchObject([
        { nodeId: "PR_kw_test", method: "SQUASH" },
      ]);
      expect(auditRows).toContainEqual(
        expect.objectContaining({ event_type: "auto_merge_armed" }),
      );
    });
  });

  describe("Lore never merges. It approves as lore-reviewer and arms GitHub's native auto-merge; GitHub performs the merge and enforces the branch rule. No pod holds merge authority.", () => {
    it("given approver is lore-reviewer, when review approves, then it submits APPROVE and writes lore_reviewer_approved audit row", async () => {
      const { deps, reviews, auditRows } = fakeProject(undefined, undefined, {
        branchRule: { requiresApprovals: 1 },
        settings: { auto_merge: { approver: "lore-reviewer" } },
      });

      await postReviewHandle(deps)(
        brief(),
        toolsReading("REVIEW_RESULT:APPROVED"),
      );

      expect(reviews).toMatchObject([{ event: "APPROVE" }]);
      expect(auditRows).toContainEqual(
        expect.objectContaining({
          event_type: "lore_reviewer_approved",
          payload: expect.objectContaining({ approver: "lore-reviewer" }),
        }),
      );
    });

    it("given approver is none, when review approves, then it arms but does not approve", async () => {
      const { deps, reviews, autoMergeCalls } = fakeProject(
        undefined,
        undefined,
        {
          branchRule: { requiresApprovals: 1 },
          settings: { auto_merge: { approver: "none" } },
        },
      );

      await postReviewHandle(deps)(
        brief(),
        toolsReading("REVIEW_RESULT:APPROVED"),
      );

      expect(autoMergeCalls).toHaveLength(1);
      expect(reviews.some((r) => r.event === "APPROVE")).toBe(false);
    });
  });

  describe("Native auto-merge is armed only where the branch rule requires an approval, never on an unprotected branch, and always before lore-reviewer approves, because GitHub refuses to arm a PR that can already merge.", () => {
    it("given an unprotected branch, when review completes, then it does not arm auto-merge", async () => {
      const { deps, autoMergeCalls } = fakeProject(undefined, undefined, {
        branchRule: { requiresApprovals: 0 },
      });

      await postReviewHandle(deps)(
        brief(),
        toolsReading("REVIEW_RESULT:APPROVED"),
      );

      expect(autoMergeCalls).toHaveLength(0);
    });
  });

  describe("The review line runs again on every push, so approving, arming and commenting each carry an idempotency key and happen once per PR state.", () => {
    it("given a re-run on the same PR state, when review completes, then it does not re-arm or re-approve", async () => {
      const { deps, autoMergeCalls, reviews } = fakeProject(
        undefined,
        undefined,
        {
          branchRule: { requiresApprovals: 1 },
          settings: { auto_merge: { approver: "lore-reviewer" } },
        },
      );

      const handle = postReviewHandle(deps);

      await handle(
        brief({ head_sha: "abc123" }),
        toolsReading("REVIEW_RESULT:APPROVED"),
      );
      await handle(
        brief({ head_sha: "abc123" }),
        toolsReading("REVIEW_RESULT:APPROVED"),
      );

      expect(autoMergeCalls).toHaveLength(1);
      expect(reviews).toHaveLength(1);
    });
  });
});
