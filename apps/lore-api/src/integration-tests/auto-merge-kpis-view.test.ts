import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

const REPO = "test/auto-merge-kpis";

const merged = (
  prNumber: number,
  sensitivePaths: string[],
  approvedBy: string[],
) => ({
  event_type: "pr_merged",
  payload: {
    prNumber,
    mergedAt: "2026-10-15T09:00:00Z",
    taskId: null,
    sensitivePaths,
    approvedBy,
  },
});

describe("pipeline.v_auto_merge_kpis", () => {
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
  });

  afterAll(async () => {
    await pool?.query("DELETE FROM pipeline.audit_log WHERE repo = $1", [REPO]);
    await pool?.end();
  });

  it("counts only PR 1, sensitive and approved by bots alone, as merged without a code owner", async () => {
    const rows = [
      merged(1, [".github/ci.yml"], ["lore-reviewer[bot]"]),
      merged(2, [".github/ci.yml"], ["lore-reviewer[bot]", "alice"]),
      merged(3, [], []),
      { event_type: "lore_reviewer_approved", payload: { prNumber: 4 } },
    ];

    await Promise.all(
      rows.map((row) =>
        pool.query(
          "INSERT INTO pipeline.audit_log (event_type, repo, payload) VALUES ($1, $2, $3)",
          [row.event_type, REPO, JSON.stringify(row.payload)],
        ),
      ),
    );
    const { rows: kpis } = await pool.query(
      `SELECT pr_number, merged_without_human, dependent_merged_before_dependency, sensitive_merged_without_codeowner
         FROM pipeline.v_auto_merge_kpis WHERE repo = $1 ORDER BY pr_number`,
      [REPO],
    );

    expect(kpis).toEqual([
      {
        pr_number: 1,
        merged_without_human: false,
        dependent_merged_before_dependency: false,
        sensitive_merged_without_codeowner: true,
      },
      {
        pr_number: 2,
        merged_without_human: false,
        dependent_merged_before_dependency: false,
        sensitive_merged_without_codeowner: false,
      },
      {
        pr_number: 3,
        merged_without_human: false,
        dependent_merged_before_dependency: false,
        sensitive_merged_without_codeowner: false,
      },
      {
        pr_number: 4,
        merged_without_human: true,
        dependent_merged_before_dependency: false,
        sensitive_merged_without_codeowner: false,
      },
    ]);
  });
});
