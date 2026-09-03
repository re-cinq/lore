import { describe, it, expect } from "vitest";
import { TaskList } from "./task-list.js";
import type { PipelineTask } from "../../types.js";
import type { TaskStorePort, TaskAction } from "./task-store-port.js";

function row(id: string, status: string, repo = "re-cinq/lore"): PipelineTask {
  return {
    id,
    description: "d",
    task_type: "implementation",
    status,
    target_repo: repo,
    review_iteration: 0,
    created_by: "tester",
    created_at: "2026-06-08T00:00:00Z",
    updated_at: "2026-06-08T00:00:00Z",
    priority: "normal",
  };
}

function fakeStore(rows: PipelineTask[]): TaskStorePort {
  const byStatus = (repo: string, status: string) =>
    rows.filter((r) => r.target_repo === repo && r.status === status);

  return {
    pending: async (repo) => byStatus(repo, "pending"),
    running: async (repo) => byStatus(repo, "running"),
    executed: async (repo) => byStatus(repo, "merged"),
    specTasksForFeature: async (repo, featureId) =>
      rows
        .filter(
          (r) =>
            r.target_repo === repo &&
            r.task_type === "spec-task" &&
            r.context_bundle?.["feature_id"] === featureId,
        )
        .map((r) => ({
          description: r.description ?? "",
          status: r.status ?? "",
          context_bundle: r.context_bundle ?? null,
        })),
    findOpenLike: async ({ repo, taskType, descriptionPrefix, statuses }) =>
      rows.filter(
        (r) =>
          r.target_repo === repo &&
          r.task_type === taskType &&
          r.description.startsWith(descriptionPrefix) &&
          statuses.includes(r.status),
      ),
    driftTasksForSpec: async () => [],
    create: async (input) => ({
      task_id: "new",
      task_type: input.taskType ?? "general",
      status: "pending",
      priority: "normal",
      created_at: "2026-01-01T00:00:00Z",
    }),
    retry: async (id) => ({ task_id: "new", status: "pending", retry_of: id }),
    list: async () => ({ tasks: rows, total: rows.length }),
    getById: async (id) => rows.find((r) => r.id === id) ?? null,
    getWithEvents: async (id) => {
      const r = rows.find((row) => row.id === id);

      return r ? { ...r, events: [] } : null;
    },
    setStatus: async (id, status) => {
      const r = rows.find((row) => row.id === id);

      if (r) {
        r.status = status;
      }
    },
    setStatusIf: async (id, expectedStatus, status) => {
      const r = rows.find((row) => row.id === id);

      if (!r || r.status !== expectedStatus) {
        return false;
      }
      r.status = status;

      return true;
    },
    updateStatus: async (id, status) => {
      const r = rows.find((row) => row.id === id);

      if (r) {
        r.status = status;
      }
    },
    recordEvent: async () => {},
    cancel: async (id) => ({ task_id: id, status: "cancelled" }),
    markMerged: async (id) => ({ task_id: id, status: "merged" }),
    transition: async (id, action: TaskAction) => {
      const r = rows.find((row) => row.id === id)!;

      const statusAfterAction: Partial<Record<TaskAction, string>> = {
        cancel: "cancelled",
        retry: "retried",
      };

      r.status = statusAfterAction[action] ?? "running-local";

      return r;
    },
  };
}

describe("TaskList", () => {
  it("returns pending Tasks for the repo as typed wrappers", async () => {
    const facade = new TaskList(
      "re-cinq/lore",
      fakeStore([
        row("a", "pending"),
        row("b", "running"),
        row("c", "pending", "other/repo"),
      ]),
    );

    const pending = await facade.pendingTasks();

    expect(
      pending.map((t) => ({ id: t.id, status: t.status, type: t.type })),
    ).toEqual([{ id: "a", status: "pending", type: "implementation" }]);
  });

  it("reflects the new status after cancel()", async () => {
    const facade = new TaskList(
      "re-cinq/lore",
      fakeStore([row("a", "pending")]),
    );

    const task = await facade.getById("a");

    await task!.cancel();

    expect(task!.status).toBe("cancelled");
  });
});
