import { describe, it, expect, vi } from "vitest";
import {
  escalateTask,
  cancelTask,
  retryTask,
  reviseTask,
} from "./pipeline-tasks.js";
import type { PgPool } from "./memory-store-types.js";

function poolWithTask(task: Record<string, unknown> | null) {
  const query = vi.fn((sql: string, _params?: unknown[]) => {
    if (sql.includes("FROM pipeline.tasks")) {
      return Promise.resolve({ rows: task === null ? [] : [task] });
    }

    return Promise.resolve({ rows: [] });
  });

  return { pool: { query } as unknown as PgPool, query };
}

const PENDING = { id: "task-1", status: "pending", priority: "normal" };

describe("escalateTask", () => {
  it("sets priority immediate on a pending task", async () => {
    const { pool, query } = poolWithTask(PENDING);

    const result = await escalateTask(pool, "task-1");

    expect(result).toEqual({ task_id: "task-1", priority: "immediate" });
    expect(
      query.mock.calls.find(([sql]) => sql.includes("UPDATE pipeline.tasks")),
    ).toMatchObject([
      expect.stringContaining("priority = 'immediate'"),
      ["task-1"],
    ]);
  });

  it("records the run-now transition with the previous priority", async () => {
    const { pool, query } = poolWithTask(PENDING);

    await escalateTask(pool, "task-1");

    const insert = query.mock.calls.find(([sql]) =>
      sql.includes("INSERT INTO pipeline.task_events"),
    );

    expect(insert?.[1]).toEqual([
      "task-1",
      "pending",
      "pending",
      JSON.stringify({ action: "run-now", previous_priority: "normal" }),
    ]);
  });

  it("throws Task not found for an unknown id", async () => {
    const { pool } = poolWithTask(null);

    await expect(escalateTask(pool, "nope")).rejects.toThrow(
      new Error("Task not found"),
    );
  });

  it("throws for a running task", async () => {
    const { pool } = poolWithTask({ ...PENDING, status: "running" });

    await expect(escalateTask(pool, "task-1")).rejects.toThrow(
      new Error("Can only escalate pending tasks, current status: running"),
    );
  });
});

describe("cancelTask terminal states", () => {
  it.each(["completed", "merged", "failed", "cancelled"])(
    "throws for a %s task",
    async (status) => {
      const { pool } = poolWithTask({ ...PENDING, status });

      await expect(cancelTask(pool, "task-1")).rejects.toThrow(
        new Error(`Cannot cancel task in ${status} state`),
      );
    },
  );

  it("cancels a running task", async () => {
    const { pool } = poolWithTask({ ...PENDING, status: "running" });

    expect(await cancelTask(pool, "task-1")).toEqual({
      task_id: "task-1",
      status: "cancelled",
    });
  });
});

describe("reviseTask", () => {
  function poolWithParent(task: Record<string, unknown> | null) {
    const query = vi.fn((sql: string, _params?: unknown[]) => {
      if (sql.includes("INSERT INTO pipeline.tasks")) {
        return Promise.resolve({ rows: [{ id: "revision-1" }] });
      }

      if (sql.includes("FROM pipeline.tasks")) {
        return Promise.resolve({ rows: task === null ? [] : [task] });
      }

      return Promise.resolve({ rows: [] });
    });

    return { pool: { query } as unknown as PgPool, query };
  }

  const PARENT = {
    id: "task-1",
    status: "pr-created",
    task_type: "feature-request",
    target_repo: "re-cinq/lore",
    target_branch: "lore/impl-x",
    pr_number: 42,
  };

  it("returns the id of the revision task it queued", async () => {
    const { pool } = poolWithParent(PARENT);

    expect(await reviseTask(pool, "task-1", "tighten the guard")).toEqual({
      task_id: "task-1",
      revision_task_id: "revision-1",
    });
  });

  it("queues the revision on the parent's branch and PR at immediate priority", async () => {
    const { pool, query } = poolWithParent(PARENT);

    await reviseTask(pool, "task-1", "tighten the guard");

    const insert = query.mock.calls.find(([sql]) =>
      sql.includes("INSERT INTO pipeline.tasks"),
    );

    expect(insert?.[0]).toContain("'immediate'");
    expect(insert?.[1]?.[4]).toEqual(
      JSON.stringify({
        parent_task_id: "task-1",
        branch: "lore/impl-x",
        pr_number: 42,
        feedback: "tighten the guard",
      }),
    );
  });

  it("keeps a feature-request revision a feature-request", async () => {
    const { pool, query } = poolWithParent(PARENT);

    await reviseTask(pool, "task-1", "again");

    const insert = query.mock.calls.find(([sql]) =>
      sql.includes("INSERT INTO pipeline.tasks"),
    );

    expect(insert?.[1]?.[1]).toEqual("feature-request");
  });

  it("refuses to revise a runbook task, pointing at a review on its pull request, and queues nothing", async () => {
    const { pool, query } = poolWithParent({ ...PARENT, task_type: "runbook" });

    await expect(reviseTask(pool, "task-1", "again")).rejects.toThrow(
      new Error(
        "Only a feature-request task is revised from here. For any other pull request, leave the feedback as a review that requests changes: Lore answers it on the pull request.",
      ),
    );
    expect(
      query.mock.calls.filter(([sql]) =>
        sql.includes("INSERT INTO pipeline.tasks"),
      ),
    ).toEqual([]);
  });

  it("records the request on the parent, naming the revision it spawned", async () => {
    const { pool, query } = poolWithParent(PARENT);

    await reviseTask(pool, "task-1", "tighten the guard");

    const event = query.mock.calls.find(([sql]) =>
      sql.includes("INSERT INTO pipeline.task_events"),
    );

    expect(event?.[1]).toEqual([
      "task-1",
      "pr-created",
      "revision-requested",
      JSON.stringify({
        feedback: "tighten the guard",
        revision_task_id: "revision-1",
      }),
    ]);
  });

  it("moves the parent to revision-requested", async () => {
    const { pool, query } = poolWithParent(PARENT);

    await reviseTask(pool, "task-1", "tighten the guard");

    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes("SET status = 'revision-requested'"),
      ),
    ).toBe(true);
  });

  it("throws Task not found for an unknown id", async () => {
    const { pool } = poolWithParent(null);

    await expect(reviseTask(pool, "nope", "x")).rejects.toThrow(
      new Error("Task not found"),
    );
  });

  it("throws for blank feedback rather than queueing an empty revision", async () => {
    const { pool } = poolWithParent(PARENT);

    await expect(reviseTask(pool, "task-1", "   ")).rejects.toThrow(
      new Error("Feedback is required"),
    );
  });
});

describe("retryTask", () => {
  it("refuses to retry a failed implementation task, whose type was removed, and leaves it failed", async () => {
    const query = vi.fn((sql: string, _params?: unknown[]) =>
      Promise.resolve({
        rows: sql.includes("FROM pipeline.tasks")
          ? [
              {
                id: "task-1",
                status: "failed",
                description: "build it",
                task_type: "implementation",
                target_repo: "re-cinq/lore",
                created_by: "ui",
              },
            ]
          : [],
      }),
    );

    await expect(
      retryTask({ query } as unknown as PgPool, "task-1"),
    ).rejects.toThrow(/^The "implementation" task type was removed\./);
    expect(
      query.mock.calls.filter(([sql]) => /^\s*(INSERT|UPDATE)/.test(sql)),
    ).toEqual([]);
  });
});
