import { describe, it, expect } from "vitest";
import { InMemoryTaskQueue } from "@re-cinq/lore-shared/project/tasks/task-queue-memory.js";
import { InMemoryTaskStore } from "@re-cinq/lore-shared/project/tasks/task-store-memory.js";
import { createDependencyPort } from "../../outbound/task-ordering.js";
import {
  approveAndMerge,
  type MergeProject,
  type Approver,
} from "./approve-merge.js";

const LORE = "lore-agent[bot]";
const TASK_7 = "00000000-0000-0000-0000-000000000007";
const TASK_8 = "00000000-0000-0000-0000-000000000008";

function makeProject(
  pulls: {
    number: number;
    state: "open" | "closed";
    mergedAt?: string;
    author: string;
    nodeId: string;
    baseBranch: string;
    autoMerge: boolean;
    body: string;
  }[],
): MergeProject {
  const store = new InMemoryTaskStore([
    {
      id: TASK_7,
      task_group_id: "group-1",
      created_at: "2026-10-15T10:00:00Z",
      context_bundle: { spec_task_id: "T002", depends_on: ["T001"] },
    },
    {
      id: TASK_8,
      task_group_id: "group-1",
      created_at: "2026-10-15T09:00:00Z",
      context_bundle: { spec_task_id: "T001", depends_on: [] },
    },
  ]);
  const queue = new InMemoryTaskQueue([
    { id: TASK_7, pr_number: 7 },
    { id: TASK_8, pr_number: 8 },
  ]);
  const ordering = createDependencyPort(store, queue);

  return {
    pulls: {
      get: async (n) => pulls.find((p) => p.number === n) ?? null,
      getBranchRule: async () => ({
        requiredApprovals: 0,
        codeOwnersReview: false,
      }),
      enableAutoMerge: async () => {},
      merge: async () => {},
    },
    codeOwners: async () => [],
    askCodeOwners: async () => {},
    loopOn: async () => true,
    audit: { write: async () => {} },
    ...ordering,
  };
}

describe("Dependency-aware arming", () => {
  it("refuses to arm or merge a PR whose dependency task has an unmerged open PR", async () => {
    const project = makeProject([
      {
        number: 7,
        state: "open",
        author: LORE,
        nodeId: "node7",
        baseBranch: "main",
        autoMerge: false,
        body: `Lore-Task: ${TASK_7}`,
      },
      {
        number: 8,
        state: "open",
        author: LORE,
        nodeId: "node8",
        baseBranch: "main",
        autoMerge: false,
        body: `Lore-Task: ${TASK_8}`,
      },
    ]);
    const approver: Approver = {
      login: LORE,
      approve: async () => {},
    };

    const step = await approveAndMerge(project, approver, 7);

    expect(step).toEqual({
      outcome: "failed",
      reason: expect.stringContaining("dependency"),
    });
  });

  it("refuses to arm or merge a PR whose dependency PR was closed without merging", async () => {
    const project = makeProject([
      {
        number: 7,
        state: "open",
        author: LORE,
        nodeId: "node7",
        baseBranch: "main",
        autoMerge: false,
        body: `Lore-Task: ${TASK_7}`,
      },
      {
        number: 8,
        state: "closed",
        author: LORE,
        nodeId: "node8",
        baseBranch: "main",
        autoMerge: false,
        body: `Lore-Task: ${TASK_8}`,
      },
    ]);
    const approver: Approver = {
      login: LORE,
      approve: async () => {},
    };

    const step = await approveAndMerge(project, approver, 7);

    expect(step).toEqual({
      outcome: "failed",
      reason: expect.stringContaining("dependency"),
    });
  });
});
