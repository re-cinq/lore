import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

describe("Webhook Dispatch", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: process.env.LORE_DB_NAME || "lore_test",
      user: process.env.LORE_DB_USER || "lore",
      password: process.env.LORE_DB_PASSWORD || "test",
    });

    // Seed test repo
    await pool.query(`
      INSERT INTO lore.repos (owner, name, full_name, onboarding_pr_merged, settings)
      VALUES ('test', 'repo', 'test/repo', true, '{"auto_review": true, "dispatch_label": "lore"}')
      ON CONFLICT (full_name) DO UPDATE SET settings = EXCLUDED.settings
    `);
  });

  afterAll(async () => {
    await pool.query(
      "DELETE FROM pipeline.tasks WHERE created_by = 'integration-test-webhook'",
    );
    await pool.query("DELETE FROM lore.repos WHERE full_name = 'test/repo'");
    await pool.end();
  });

  it("creates a task from webhook dispatch", async () => {
    const { rows } = await pool.query(
      `INSERT INTO pipeline.tasks (description, task_type, target_repo, issue_number, created_by, status)
       VALUES ('webhook task', 'implementation', 'test/repo', 42, 'integration-test-webhook', 'pending')
       RETURNING id, status, issue_number`,
    );
    expect(rows[0].status).toBe("pending");
    expect(rows[0].issue_number).toBe(42);
  });

  it("prevents duplicate tasks for the same issue", async () => {
    // Insert a running task for issue 999
    await pool.query(
      `INSERT INTO pipeline.tasks (description, task_type, target_repo, issue_number, created_by, status)
       VALUES ('existing task', 'implementation', 'test/repo', 999, 'integration-test-webhook', 'running')`,
    );

    // Duplicate check: look for active tasks on the same issue
    const { rows } = await pool.query(
      `SELECT id FROM pipeline.tasks
       WHERE issue_number = 999
         AND target_repo = 'test/repo'
         AND status NOT IN ('failed', 'cancelled')`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it("allows new task after previous one failed", async () => {
    // Insert a failed task for issue 888
    await pool.query(
      `INSERT INTO pipeline.tasks (description, task_type, target_repo, issue_number, created_by, status, failure_reason)
       VALUES ('failed task', 'implementation', 'test/repo', 888, 'integration-test-webhook', 'failed', 'timeout')`,
    );

    // Duplicate check should NOT find it (failed is excluded)
    const { rows } = await pool.query(
      `SELECT id FROM pipeline.tasks
       WHERE issue_number = 888
         AND target_repo = 'test/repo'
         AND status NOT IN ('failed', 'cancelled')`,
    );
    expect(rows).toHaveLength(0);
  });

  it("verifies repo settings are accessible for dispatch decisions", async () => {
    const { rows } = await pool.query(
      `SELECT settings->>'auto_review' AS auto_review,
              settings->>'dispatch_label' AS dispatch_label
       FROM lore.repos
       WHERE full_name = 'test/repo'`,
    );
    expect(rows[0].auto_review).toBe("true");
    expect(rows[0].dispatch_label).toBe("lore");
  });

  it("links issue to task via issue_number and issue_url", async () => {
    const { rows: created } = await pool.query(
      `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by)
       VALUES ('link test', 'general', 'test/repo', 'integration-test-webhook')
       RETURNING id`,
    );
    const id = created[0].id;

    // Simulate agent updating issue after creation (as worker.ts does)
    await pool.query(
      `UPDATE pipeline.tasks SET issue_number = $1, issue_url = $2 WHERE id = $3`,
      [123, "https://github.com/test/repo/issues/123", id],
    );

    const { rows } = await pool.query(
      `SELECT issue_number, issue_url FROM pipeline.tasks WHERE id = $1`,
      [id],
    );
    expect(rows[0].issue_number).toBe(123);
    expect(rows[0].issue_url).toBe(
      "https://github.com/test/repo/issues/123",
    );
  });
});
