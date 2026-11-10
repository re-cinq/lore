import { describe, it, expect } from "vitest";
import { InMemoryAudit } from "@re-cinq/lore-shared/project/audit/audit-memory.js";
import { Audit } from "@re-cinq/lore-shared/project/audit/audit.js";
import { InMemoryPrBlockedReasons } from "@re-cinq/lore-shared/project/pr-blocked-reasons/pr-blocked-reasons-memory.js";
import type { PullRef } from "@re-cinq/lore-shared/project/pulls/pull-requests-port.js";
import { InMemoryTaskQueue } from "@re-cinq/lore-shared/project/tasks/task-queue-memory.js";
import { InMemoryTaskStore } from "@re-cinq/lore-shared/project/tasks/task-store-memory.js";
import { createDependencyPort } from "../outbound/task-ordering.js";
import { blockedReasonComment } from "./comment.js";
import { InMemoryCommentThread } from "./comment-thread-memory.js";
import {
  runBlockedReason,
  type BlockedReasonDeps,
  type ReasonEvent,
} from "./station.js";

const REPO = "re-cinq/lore";
const LORE = "lore-app[bot]";
const TASK_7 = "00000000-0000-0000-0000-000000000007";
const TASK_8 = "00000000-0000-0000-0000-000000000008";

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

function buildWorld(
  pulls: PullRef[],
  tasks = [
    {
      id: TASK_7,
      target_repo: REPO,
      task_group_id: "group-1",
      created_at: "2026-10-15T10:00:00Z",
      context_bundle: { spec_task_id: "T002", depends_on: ["T001"] },
    },
    {
      id: TASK_8,
      target_repo: REPO,
      task_group_id: "group-1",
      created_at: "2026-10-15T09:00:00Z",
      context_bundle: { spec_task_id: "T001", depends_on: [] },
    },
  ],
) {
  const audit = new InMemoryAudit();
  const reasons = new InMemoryPrBlockedReasons();
  const thread = new InMemoryCommentThread();
  const store = new InMemoryTaskStore(tasks);
  const queue = new InMemoryTaskQueue(
    tasks.map((t, i) => ({
      ...t,
      pr_number: i === 0 ? 7 : 8,
    })),
  );
  const ordering = createDependencyPort(store, queue);
  const deps: BlockedReasonDeps = {
    appLogin: async () => LORE,
    reasons,
    project: async (repo) => ({
      pulls: {
        get: async (number) => pulls.find((p) => p.number === number) ?? null,
        list: async () => pulls.filter((p) => p.state === "open"),
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
      ...ordering,
    }),
  };

  return { deps, reasons, thread, audit };
}

describe("Dependency-aware merge ordering", () => {
  it("records blocked_by_pr when a PR's task depends on another task in the same group that has an unmerged open PR", async () => {
    const pulls = [
      pr(7, {
        body: `Adds dependent feature.

Lore-Task: ${TASK_7}`,
      }),
      pr(8, {
        body: `Adds dependency.

Lore-Task: ${TASK_8}`,
      }),
    ];
    const { deps, reasons, thread } = buildWorld(pulls);
    const event: ReasonEvent = {
      name: "github.pull_request.opened",
      params: { repo: REPO, pr_number: 7 },
    };

    await runBlockedReason(event, deps);

    expect(await reasons.current(REPO, 7)).toEqual({
      reason: "blocked_by_pr",
      detail: "8",
    });
    expect(thread.comments).toEqual([
      {
        number: 7,
        id: 1,
        body: blockedReasonComment({ reason: "blocked_by_pr", detail: "8" }),
      },
    ]);
  });

  it("clears blocked_by_pr on a dependent PR when its dependency's pull_request.closed arrives with merged: true", async () => {
    const pulls = [
      pr(7, {
        body: `Adds dependent feature.

Lore-Task: ${TASK_7}`,
      }),
      pr(8, {
        body: `Adds dependency.

Lore-Task: ${TASK_8}`,
      }),
    ];
    const { deps, reasons } = buildWorld(pulls);

    await runBlockedReason(
      {
        name: "github.pull_request.opened",
        params: { repo: REPO, pr_number: 7 },
      },
      deps,
    );
    pulls[1] = pr(8, {
      state: "closed",
      mergedAt: "2026-10-15T11:00:00Z",
      body: `Adds dependency.

Lore-Task: ${TASK_8}`,
    });
    await runBlockedReason(
      {
        name: "github.pull_request.closed",
        params: { repo: REPO, pr_number: 8, merged: true },
      },
      deps,
    );

    expect(await reasons.current(REPO, 7)).toBeNull();
  });

  it("keeps blocked_by_pr on a dependent PR when its dependency PR is closed without merging", async () => {
    const pulls = [
      pr(7, {
        body: `Adds dependent feature.

Lore-Task: ${TASK_7}`,
      }),
      pr(8, {
        state: "closed",
        body: `Adds dependency.

Lore-Task: ${TASK_8}`,
      }),
    ];
    const { deps, reasons } = buildWorld(pulls);

    await runBlockedReason(
      {
        name: "github.pull_request.opened",
        params: { repo: REPO, pr_number: 7 },
      },
      deps,
    );

    expect(await reasons.current(REPO, 7)).toEqual({
      reason: "blocked_by_pr",
      detail: "8",
    });
  });

  it("orders sibling tasks in the same group by creation time when neither depends on the other", async () => {
    const pulls = [
      pr(7, {
        body: `Newer sibling.

Lore-Task: ${TASK_7}`,
      }),
      pr(8, {
        body: `Older sibling.

Lore-Task: ${TASK_8}`,
      }),
    ];
    const { deps, reasons } = buildWorld(pulls, [
      {
        id: TASK_7,
        target_repo: REPO,
        task_group_id: "group-1",
        created_at: "2026-10-15T10:00:00Z",
        context_bundle: { spec_task_id: "T002", depends_on: [] },
      },
      {
        id: TASK_8,
        target_repo: REPO,
        task_group_id: "group-1",
        created_at: "2026-10-15T09:00:00Z",
        context_bundle: { spec_task_id: "T001", depends_on: [] },
      },
    ]);

    await runBlockedReason(
      {
        name: "github.pull_request.opened",
        params: { repo: REPO, pr_number: 7 },
      },
      deps,
    );

    expect(await reasons.current(REPO, 7)).toEqual({
      reason: "blocked_by_pr",
      detail: "8",
    });
  });
});
