import { describe, it, expect } from "vitest";
import { retryTask } from "./pipeline-tasks.js";
import type { PgPool } from "./memory-store.js";

/** Routes by SQL rather than call order, so the sequence can change without
 *  silently starving a query into its not-found branch. */
function mockPool(task: Record<string, unknown>) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });

      if (sql.includes("SELECT * FROM pipeline.tasks")) {
        return { rows: [task] };
      }

      if (sql.includes("SELECT status FROM pipeline.tasks")) {
        return { rows: [{ status: task.status }] };
      }

      if (sql.includes("INSERT INTO pipeline.tasks")) {
        return { rows: [{ id: "t2", status: "pending", priority: "normal" }] };
      }

      return { rows: [] };
    },
  } as unknown as PgPool;

  return { pool, calls };
}

const failedSpecTask = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  description: "Implement the thing",
  task_type: "spec-task",
  target_repo: "re-cinq/lore",
  status: "failed",
  created_by: "ui",
  context_bundle: { feature_id: "f1", spec_path: "specs/thing/spec.md" },
  task_group_id: "g1",
  ...over,
});

const insertOf = (calls: Array<{ sql: string; values?: unknown[] }>) =>
  calls.find((c) => c.sql.includes("INSERT INTO pipeline.tasks"));

describe("retryTask", () => {
  // The replacement IS the superseded task's work. Dropping the group orphaned
  // it from its own spec-task DAG and left the `retried` original as a
  // permanently outstanding row that no merge could ever clear (FR1).
  it("the replacement inherits the original's task_group_id", async () => {
    const { pool, calls } = mockPool(failedSpecTask());

    const result = await retryTask(pool, "t1");

    expect(insertOf(calls)?.sql).toContain("task_group_id");
    expect(insertOf(calls)?.values).toContain("g1");
    expect(result).toMatchObject({ task_id: "t2", retry_of: "t1" });
  });

  it("carries the context bundle across, tagged with retry_of", async () => {
    const { pool, calls } = mockPool(failedSpecTask());

    await retryTask(pool, "t1");
    const bundle = insertOf(calls)?.values?.find(
      (v) => typeof v === "string" && v.includes("feature_id"),
    );

    expect(JSON.parse(bundle as string)).toEqual({
      feature_id: "f1",
      spec_path: "specs/thing/spec.md",
      retry_of: "t1",
    });
  });

  it("marks the original retried", async () => {
    const { pool, calls } = mockPool(failedSpecTask());

    await retryTask(pool, "t1");
    const update = calls.find((c) => c.sql.includes("UPDATE pipeline.tasks"));

    expect(update?.values).toEqual(expect.arrayContaining(["retried", "t1"]));
  });

  it("a groupless task's replacement stays groupless", async () => {
    const { pool, calls } = mockPool(failedSpecTask({ task_group_id: null }));

    await retryTask(pool, "t1");

    expect(insertOf(calls)?.sql).not.toContain("task_group_id");
  });

  it("refuses to retry a task that is not failed or needs-human-help", async () => {
    const { pool } = mockPool(failedSpecTask({ status: "merged" }));

    await expect(retryTask(pool, "t1")).rejects.toThrow(
      new Error(
        "Cannot retry task in merged state (must be failed or needs-human-help)",
      ),
    );
  });
});

// Appended, not inserted: specs/spec-status-upkeep/spec.md links the tests above
// by line number.
describe("retryTask — priority", () => {
  const priorityOf = (calls: Array<{ sql: string; values?: unknown[] }>) =>
    insertOf(calls)?.values?.[5];

  it("an immediate task's retry stays immediate", async () => {
    const { pool, calls } = mockPool(failedSpecTask({ priority: "immediate" }));

    await retryTask(pool, "t1");

    expect(priorityOf(calls)).toBe("immediate");
  });

  it("a normal task's retry stays normal", async () => {
    const { pool, calls } = mockPool(failedSpecTask({ priority: "normal" }));

    await retryTask(pool, "t1");

    expect(priorityOf(calls)).toBe("normal");
  });
});
