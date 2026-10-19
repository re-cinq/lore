import { describe, it, expect, vi } from "vitest";
import { retryTask } from "./pipeline-task-actions.js";
import type { PgPool } from "./memory-store-types.js";

function poolWithTask(task: Record<string, unknown>) {
  const query = vi.fn((sql: string, _params?: unknown[]) =>
    Promise.resolve({
      rows: sql.includes("FROM pipeline.tasks") ? [task] : [],
    }),
  );

  return { pool: { query } as unknown as PgPool, query };
}

describe("retryTask – implementation-loop guard", () => {
  it("refuses an implementation-loop task and mentions removing lore:blocked", async () => {
    const { pool } = poolWithTask({
      id: "task-1",
      status: "failed",
      description: "build it",
      task_type: "implementation-loop",
      target_repo: "re-cinq/lore",
      created_by: "loop",
    });

    await expect(retryTask(pool, "task-1")).rejects.toThrow(
      /remove the lore:blocked label/,
    );
  });

  it("leaves the task unchanged — no INSERT or UPDATE issued", async () => {
    const { pool, query } = poolWithTask({
      id: "task-1",
      status: "failed",
      description: "build it",
      task_type: "implementation-loop",
      target_repo: "re-cinq/lore",
      created_by: "loop",
    });

    await expect(retryTask(pool, "task-1")).rejects.toThrow();
    expect(
      query.mock.calls.filter(([sql]) => /^\s*(INSERT|UPDATE)/.test(sql)),
    ).toEqual([]);
  });
});
