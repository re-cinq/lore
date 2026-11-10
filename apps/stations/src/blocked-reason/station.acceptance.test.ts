import { describe, it, expect } from "vitest";
import { InMemoryAudit } from "@re-cinq/lore-shared/project/audit/audit-memory.js";
import { Audit } from "@re-cinq/lore-shared/project/audit/audit.js";
import { InMemoryPrBlockedReasons } from "@re-cinq/lore-shared/project/pr-blocked-reasons/pr-blocked-reasons-memory.js";
import type {
  PullRef,
  PullReview,
  Mergeability,
} from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { InMemoryCommentThread } from "./comment-thread-memory.js";
import { blockedReasonComment } from "./comment.js";
import { runBlockedReason, type BlockedReasonDeps } from "./station.js";

const REPO = "re-cinq/lore";
const LORE = "lore-app[bot]";

const pr = (number: number, fields: Partial<PullRef> = {}): PullRef => ({
  repo: REPO,
  number,
  title: `PR ${number}`,
  branch: `lore/${number}`,
  state: "open",
  labels: [],
  url: `https://github.com/${REPO}/pull/${number}`,
  author: LORE,
  headSha: `sha${number}`,
  baseBranch: "main",
  ...fields,
});

function world(pulls: PullRef[]) {
  const audit = new InMemoryAudit();
  const reasons = new InMemoryPrBlockedReasons();
  const thread = new InMemoryCommentThread();
  const reviews = new Map<number, PullReview[]>();
  const mergeability = new Map<number, Mergeability>();

  const taskGroups = new Map<
    number,
    { task_group_id: string; depends_on?: number[] }
  >();
  const reviewsInFlight = new Map<number, string>();

  const deps: BlockedReasonDeps = {
    appLogin: async () => LORE,
    reasons,
    project: async (repo) => ({
      pulls: {
        get: async (number: number) =>
          pulls.find((p) => p.number === number) ?? null,
        list: async () => pulls,
        getMergeability: async (number: number) =>
          mergeability.get(number) ?? { mergeable: true, state: "clean" },
        getBranchRule: async () => ({
          requiredApprovals: 0,
          codeOwnersReview: false,
          requiredChecks: [],
        }),
        listChecks: async () => [],
        ciConclusion: async () => "success",
        listReviews: async (number: number) => reviews.get(number) ?? [],
        listFiles: async () => [],
      },
      repo: { read: async () => null },
      issues: thread,
      audit: new Audit(repo, audit),
      taskIssue: async () => null,
      autoMergeOn: async () => true,
      taskGroup: async (number: number) => taskGroups.get(number),
      hasReviewInFlight: async (number: number) =>
        reviewsInFlight.get(number) === "yes",
    }),
  };

  return {
    deps,
    audit,
    reasons,
    thread,
    mergeability,
    taskGroups,
    reviewsInFlight,
  };
}

describe("Blocked Reason Acceptance Tests", () => {
  it("reports first named refusal", async () => {
    const w = world([pr(7)]);
    const event = {
      name: "lore.pull_request.merge_refused",
      params: {
        repo: REPO,
        pr_number: 7,
        message: "Pull request is not mergeable",
      },
    };
    const expected = {
      reason: "github_refused" as const,
      detail: "Pull request is not mergeable",
    };

    await runBlockedReason(event, w.deps);
    await runBlockedReason(event, w.deps);

    expect({
      current: await w.reasons.current(REPO, 7),
      audited: w.audit.entries.length,
      comments: w.thread.comments,
    }).toEqual({
      current: expected,
      audited: 1,
      comments: [{ number: 7, id: 1, body: blockedReasonComment(expected) }],
    });
  });

  it("surfaces github_refused only after three consecutive unclassified refusals", async () => {
    const w = world([pr(7)]);
    const event = {
      name: "lore.pull_request.merge_refused",
      params: { repo: REPO, pr_number: 7, message: "unknown server error" },
    };

    await runBlockedReason(event, w.deps);
    expect(await w.reasons.current(REPO, 7)).toEqual(null);

    await runBlockedReason(event, w.deps);
    expect(await w.reasons.current(REPO, 7)).toEqual(null);

    await runBlockedReason(event, w.deps);
    expect(await w.reasons.current(REPO, 7)).toEqual({
      reason: "github_refused",
      detail: "unknown server error",
    });
  });

  it("assigns blocked_by_pr when a dependency PR in the same task group is unmerged", async () => {
    const w = world([pr(7), pr(8)]);

    w.taskGroups.set(8, { task_group_id: "group-1", depends_on: [7] });

    await runBlockedReason(
      {
        name: "github.pull_request.opened",
        params: { repo: REPO, pr_number: 8 },
      },
      w.deps,
    );

    expect(await w.reasons.current(REPO, 8)).toEqual({
      reason: "blocked_by_pr",
      detail: "7",
    });
  });

  it("keeps blocked_by_pr when a dependency PR is closed without merging", async () => {
    const w = world([pr(7, { state: "closed" }), pr(8)]);

    w.taskGroups.set(8, { task_group_id: "group-1", depends_on: [7] });

    await runBlockedReason(
      {
        name: "github.pull_request.opened",
        params: { repo: REPO, pr_number: 8 },
      },
      w.deps,
    );

    expect(await w.reasons.current(REPO, 8)).toEqual({
      reason: "blocked_by_pr",
      detail: "7",
    });
  });

  it("assigns review_in_flight when a re-review is requested on an already-approved head", async () => {
    const w = world([pr(7)]);

    w.reviewsInFlight.set(7, "yes");

    await runBlockedReason(
      {
        name: "github.pull_request.synchronize",
        params: { repo: REPO, pr_number: 7 },
      },
      w.deps,
    );

    expect(await w.reasons.current(REPO, 7)).toEqual({
      reason: "review_in_flight",
      detail: null,
    });
  });
});
