import { describe, it, expect } from "vitest";
import { InMemoryAudit } from "@re-cinq/lore-shared/project/audit/audit-memory.js";
import { Audit } from "@re-cinq/lore-shared/project/audit/audit.js";
import { InMemoryPrBlockedReasons } from "@re-cinq/lore-shared/project/pr-blocked-reasons/pr-blocked-reasons-memory.js";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { InMemoryCommentThread } from "./comment-thread-memory.js";
import { runBlockedReason, type ReasonEvent } from "./station.js";

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

describe("Dependency-aware merge ordering", () => {
  it("records blocked_by_pr when a PR's task depends on another task in the same group that has an unmerged open PR", async () => {
    const pulls = [
      pr(7, { body: "Adds dependent feature.\n\nLore-Task: task-7" }),
      pr(8, { body: "Adds dependency.\n\nLore-Task: task-8" }),
    ];

    const audit = new InMemoryAudit();
    const reasons = new InMemoryPrBlockedReasons();
    const thread = new InMemoryCommentThread();

    const deps = {
      appLogin: async () => LORE,
      reasons,
      project: async (repo: string) =>
        ({
          pulls: {
            get: async (number: number) =>
              pulls.find((p) => p.number === number) ?? null,
            list: async () => pulls,
            getMergeability: async () => ({ mergeable: true, state: "clean" }),
            getBranchRule: async () => ({
              requiredApprovals: 0,
              codeOwnersReview: false,
              requiredChecks: [],
            }),
            listChecks: async () => [],
            ciConclusion: async () => "success",
            listReviews: async () => [],
            listFiles: async () => [],
          },
          repo: { read: async () => null },
          issues: thread,
          audit: new Audit(repo, audit),
          taskIssue: async () => null,
          autoMergeOn: async () => false,

          getTaskGroup: async () => "group-1",
          getTaskDependsOn: async (taskId: string) =>
            taskId === "task-7" ? ["task-8"] : [],
          getTaskPr: async (taskId: string) => {
            if (taskId === "task-7") {
              return 7;
            }

            if (taskId === "task-8") {
              return 8;
            }

            return null;
          },
        }) as any,
    };

    const event: ReasonEvent = {
      name: "github.pull_request.opened",
      params: { repo: REPO, pr_number: 7 },
    };

    await runBlockedReason(event, deps as any);

    const current = await reasons.current(REPO, 7);

    expect(current).toEqual({
      reason: "blocked_by_pr",
      detail: expect.any(String),
    });
  });
});
