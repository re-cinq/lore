import { describe, it, expect } from "vitest";
import { TaskList } from "./task-list.js";
import type { PipelineTask } from "../../types.js";
import type { TaskStorePort, TaskAction } from "./task-store-port.js";

/**
 * project.tasks.pendingTasks() returns Task wrappers bound to the repo, and a
 * transition re-reads the row. The fake is a tiny in-memory store.
 */

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
    getById: async (id) => rows.find((r) => r.id === id) ?? null,
    transition: async (id, action: TaskAction) => {
      const r = rows.find((x) => x.id === id)!;
      r.status = action === "cancel" ? "cancelled" : action === "retry" ? "retried" : "running-local";
      return r;
    },
  };
}

describe("TaskList", () => {
  it("returns pending Tasks for the repo as typed wrappers", async () => {
    const facade = new TaskList(
      "re-cinq/lore",
      fakeStore([row("a", "pending"), row("b", "running"), row("c", "pending", "other/repo")]),
    );

    const pending = await facade.pendingTasks();

    expect(pending.map((t) => ({ id: t.id, status: t.status, type: t.type }))).toEqual([
      { id: "a", status: "pending", type: "implementation" },
    ]);
  });

  it("reflects the new status after cancel()", async () => {
    const facade = new TaskList("re-cinq/lore", fakeStore([row("a", "pending")]));

    const task = await facade.getById("a");
    await task!.cancel();

    expect(task!.status).toBe("cancelled");
  });
});
