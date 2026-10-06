import { describe, it, expect, vi } from "vitest";
import { escalateTask, cancelTask, retryTask } from "./pipeline-tasks.js";
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
