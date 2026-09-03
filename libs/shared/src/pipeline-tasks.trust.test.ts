import { describe, it, expect, vi } from "vitest";
import { createTask } from "./pipeline-tasks.js";
import type { PgPool } from "./memory-store.js";

function poolWithTrust(level: string | null) {
  const query = vi.fn((sql: string, _params?: unknown[]) => {
    if (sql.includes("SELECT settings")) {
      return Promise.resolve({
        rows: level === null ? [] : [{ settings: { trust: { level } } }],
      });
    }

    if (sql.includes("INSERT INTO pipeline.tasks")) {
      return Promise.resolve({
        rows: [
          {
            id: "task-1",
            status: "pending",
            priority: "normal",
            created_at: "2026-01-01T00:00:00.000Z",
          },
        ],
      });
    }

    return Promise.resolve({ rows: [] });
  });

  return { pool: { query } as unknown as PgPool, query };
}

describe("createTask trust gate", () => {
  it.each(["docs", "tests", "implementation", "full"])(
    "allows an onboard task at trust level %s",
    async (level) => {
      const { pool } = poolWithTrust(level);

      const result = await createTask(pool, {
        description: "onboard o/r",
        taskType: "onboard",
        targetRepo: "o/r",
      });

      expect(result).toMatchObject({ task_id: "task-1" });
    },
  );

  it("still refuses an implementation task at trust level docs", async () => {
    const { pool } = poolWithTrust("docs");

    await expect(
      createTask(pool, {
        description: "build it",
        taskType: "implementation",
        targetRepo: "o/r",
      }),
    ).rejects.toThrow(/not allowed at trust level "docs"/);
  });
});

describe("implementation-loop trust", () => {
  it("allows an implementation-loop task at trust level implementation", async () => {
    const { pool } = poolWithTrust("implementation");

    const result = await createTask(pool, {
      description: "work the backlog",
      taskType: "implementation-loop",
      targetRepo: "o/r",
    });

    expect(result).toMatchObject({ task_id: "task-1" });
  });

  it("refuses an implementation-loop task at trust level tests", async () => {
    const { pool } = poolWithTrust("tests");

    await expect(
      createTask(pool, {
        description: "work the backlog",
        taskType: "implementation-loop",
        targetRepo: "o/r",
      }),
    ).rejects.toThrow(/not allowed at trust level "tests"/);
  });
});

describe("createTask group linking", () => {
  it("inserts task_group_id grp-1 as the seventh insert parameter", async () => {
    const { pool, query } = poolWithTrust("full");

    await createTask(pool, {
      description: "onboard o/r",
      taskType: "onboard",
      targetRepo: "o/r",
      taskGroupId: "grp-1",
    });

    const insert = query.mock.calls.find(([sql]) =>
      sql.includes("INSERT INTO pipeline.tasks"),
    );

    expect(insert?.[0]).toContain("task_group_id");
    expect(insert?.[1]).toMatchObject({ 6: "grp-1", length: 7 });
  });

  it("inserts six parameters and no task_group_id column without a group id", async () => {
    const { pool, query } = poolWithTrust("full");

    await createTask(pool, {
      description: "onboard o/r",
      taskType: "onboard",
      targetRepo: "o/r",
    });

    const insert = query.mock.calls.find(([sql]) =>
      sql.includes("INSERT INTO pipeline.tasks"),
    );

    expect(insert?.[0]).not.toContain("task_group_id");
    expect(insert?.[1]).toMatchObject({ length: 6 });
  });
});
