import { describe, it, expect } from "vitest";
import {
  approveAndMerge,
  type MergeProject,
  type Approver,
} from "./approve-merge.js";

const LORE = "lore-agent[bot]";

describe("Dependency-aware arming", () => {
  it("refuses to arm or merge a PR whose dependency task has an unmerged open PR", async () => {
    const pulls = [
      {
        number: 7,
        state: "open",
        author: LORE,
        nodeId: "node7",
        baseBranch: "main",
        autoMerge: false,
        body: "Lore-Task: task-7",
      },
      {
        number: 8,
        state: "open",
        author: LORE,
        nodeId: "node8",
        baseBranch: "main",
        autoMerge: false,
        body: "Lore-Task: task-8",
      },
    ];

    const project: MergeProject = {
      pulls: {
        get: async (n: number) => pulls.find((p) => p.number === n) ?? null,
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
    } as any;

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
