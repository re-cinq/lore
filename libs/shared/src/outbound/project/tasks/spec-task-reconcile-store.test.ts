import { describe, it, expect } from "vitest";
import { InMemoryTaskStore } from "./task-store-memory.js";

const REPO = "re-cinq/lore";
const PLAN = "3b3a67af";
const RUN = "18773dbb-5972-43f1-8a2a-5db8831bcc5a";

const wanted = (specTaskId: string, issueNumber: number) => ({
  description: `${specTaskId} as decomposed again`,
  taskType: "spec-task",
  taskGroupId: RUN,
  issueNumber,
  issueUrl: `https://github.com/${REPO}/issues/${issueNumber}`,
  contextBundle: { spec_task_id: specTaskId, plan_id: PLAN },
});

describe("reconcileSpecTasks", () => {
  it("reuses plan 3b3a67af's failed T001 on issue #2261, creates T002 and cancels T009 the rerun dropped", async () => {
    const store = new InMemoryTaskStore([
      {
        id: "t001",
        task_type: "spec-task",
        target_repo: REPO,
        status: "failed",
        task_group_id: RUN,
        issue_number: null,
        context_bundle: { spec_task_id: "T001" },
      },
      {
        id: "t009",
        task_type: "spec-task",
        target_repo: REPO,
        status: "failed",
        task_group_id: RUN,
        issue_number: null,
        context_bundle: { spec_task_id: "T009" },
      },
    ]);

    const result = await store.reconcileSpecTasks(REPO, {
      planId: PLAN,
      groupId: RUN,
      tasks: [wanted("T001", 2261), wanted("T002", 2262)],
    });

    expect({
      result,
      rows: store.tasks.map((t) => ({
        id: t.id === "t001" || t.id === "t009" ? t.id : "new",
        status: t.status,
        issue_number: t.issue_number,
        description: t.description,
      })),
    }).toEqual({
      result: { created: 1, updated: 1, cancelled: 1 },
      rows: [
        {
          id: "t001",
          status: "pending",
          issue_number: 2261,
          description: "T001 as decomposed again",
        },
        {
          id: "t009",
          status: "cancelled",
          issue_number: null,
          description: undefined,
        },
        {
          id: "new",
          status: "pending",
          issue_number: 2262,
          description: "T002 as decomposed again",
        },
      ],
    });
  });

  it("leaves another plan's spec-tasks in the repo alone", async () => {
    const store = new InMemoryTaskStore([
      {
        id: "other",
        task_type: "spec-task",
        target_repo: REPO,
        status: "pending",
        task_group_id: "another-run",
        context_bundle: { spec_task_id: "T001", plan_id: "another-plan" },
      },
    ]);

    await store.reconcileSpecTasks(REPO, {
      planId: PLAN,
      groupId: RUN,
      tasks: [wanted("T001", 2261)],
    });

    expect(store.tasks.find((t) => t.id === "other")?.status).toBe("pending");
  });
});
