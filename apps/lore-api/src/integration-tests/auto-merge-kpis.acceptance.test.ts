import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

const REPO = "test/auto-merge-kpis-acceptance";

const merged = (
  prNumber: number,
  taskId: string | null,
  mergedAt: string,
  dependsOn: string[] = [],
) => ({
  event_type: "pr_merged",
  task_id: taskId,
  payload: {
    prNumber,
    mergedAt,
    taskId,
    dependsOn,
    sensitivePaths: [],
    approvedBy: [],
  },
});

const approved = (prNumber: number) => ({
  event_type: "lore_reviewer_approved",
  task_id: null,
  payload: {
    prNumber,
  },
});

describe("pipeline.v_auto_merge_kpis acceptance", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: process.env.LORE_DB_NAME || "lore",
      user: process.env.LORE_DB_USER || "lore",
      password: process.env.LORE_DB_PASSWORD || "test",
    });
    await pool.query("DELETE FROM pipeline.audit_log WHERE repo = $1", [REPO]);
    await pool.query("DELETE FROM pipeline.tasks WHERE target_repo = $1", [
      REPO,
    ]);
  });

  afterAll(async () => {
    await pool?.query("DELETE FROM pipeline.audit_log WHERE repo = $1", [REPO]);
    await pool?.query("DELETE FROM pipeline.tasks WHERE target_repo = $1", [
      REPO,
    ]);
    await pool?.end();
  });

  it("computes dependency-order violations from actual dependency/merge evidence and distinguishes approvals from actual merged PR outcomes without double-counting the same PR", async () => {
    const t1 = "00000000-0000-0000-0000-000000000001";
    const t2 = "00000000-0000-0000-0000-000000000002";

    await pool.query(
      "INSERT INTO pipeline.tasks (id, description, target_repo, task_group_id) VALUES ($1, $2, $3, $4)",
      [t1, "Task 1", REPO, "tg1"],
    );
    await pool.query(
      "INSERT INTO pipeline.tasks (id, description, target_repo, task_group_id) VALUES ($1, $2, $3, $4)",
      [t2, "Task 2", REPO, "tg1"],
    );

    const rows = [
      approved(10),
      merged(10, null, "2026-10-15T09:00:00Z"),

      approved(11),

      merged(12, null, "2026-10-15T09:00:00Z"),

      merged(13, t1, "2026-10-15T10:00:00Z"),
      merged(14, t2, "2026-10-15T09:00:00Z", [t1]),
    ];

    for (const row of rows) {
      await pool.query(
        "INSERT INTO pipeline.audit_log (event_type, repo, task_id, payload) VALUES ($1, $2, $3, $4)",
        [row.event_type, REPO, row.task_id, JSON.stringify(row.payload)],
      );
    }

    const { rows: kpis } = await pool.query(
      `SELECT pr_number, merged_without_human, dependent_merged_before_dependency
       FROM pipeline.v_auto_merge_kpis
       WHERE repo = $1
       ORDER BY pr_number`,
      [REPO],
    );

    expect(kpis).toEqual([
      {
        pr_number: 10,
        merged_without_human: true,
        dependent_merged_before_dependency: false,
      },
      {
        pr_number: 12,
        merged_without_human: false,
        dependent_merged_before_dependency: false,
      },
      {
        pr_number: 13,
        merged_without_human: false,
        dependent_merged_before_dependency: false,
      },
      {
        pr_number: 14,
        merged_without_human: false,
        dependent_merged_before_dependency: true,
      },
    ]);
  });
});
