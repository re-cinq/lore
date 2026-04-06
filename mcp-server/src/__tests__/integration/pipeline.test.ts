import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

describe("Pipeline Task Lifecycle", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: process.env.LORE_DB_NAME || "lore_test",
      user: process.env.LORE_DB_USER || "lore",
      password: process.env.LORE_DB_PASSWORD || "test",
    });
    // Verify connection and schema
    await pool.query("SELECT 1");
  });

  afterAll(async () => {
    // Delete events first (FK constraint), then tasks
    await pool.query(
      "DELETE FROM pipeline.task_events WHERE task_id IN (SELECT id FROM pipeline.tasks WHERE created_by = 'integration-test')",
    );
    await pool.query(
      "DELETE FROM pipeline.tasks WHERE created_by = 'integration-test'",
    );
    await pool.end();
  });

  it("creates a task in pending status", async () => {
    const { rows } = await pool.query(
      `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by)
       VALUES ('test task', 'general', 're-cinq/lore', 'integration-test')
       RETURNING id, status`,
    );
    expect(rows[0].status).toBe("pending");
  });

  it("claims a task atomically", async () => {
    const { rows: created } = await pool.query(
      `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by)
       VALUES ('claim test', 'implementation', 're-cinq/lore', 'integration-test')
       RETURNING id`,
    );
    const taskId = created[0].id;

    const { rows: claimed } = await pool.query(
      `UPDATE pipeline.tasks
       SET status = 'running', claimed_by = 'test-agent', claimed_at = now()
       WHERE id = $1 AND status = 'pending'
       RETURNING id, status, claimed_by`,
      [taskId],
    );
    expect(claimed[0].status).toBe("running");
    expect(claimed[0].claimed_by).toBe("test-agent");

    // Second claim attempt should return no rows (atomic guard)
    const { rows: doubleClaim } = await pool.query(
      `UPDATE pipeline.tasks
       SET status = 'running', claimed_by = 'other-agent'
       WHERE id = $1 AND status = 'pending'
       RETURNING id`,
      [taskId],
    );
    expect(doubleClaim).toHaveLength(0);
  });

  it("30s grace period excludes recently created tasks", async () => {
    const { rows: created } = await pool.query(
      `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by)
       VALUES ('grace test', 'implementation', 're-cinq/lore', 'integration-test')
       RETURNING id`,
    );

    // GKE worker query uses a 30s grace period to avoid race conditions
    const { rows: gkeResult } = await pool.query(
      `SELECT id FROM pipeline.tasks
       WHERE status = 'pending'
         AND created_at < now() - interval '30 seconds'
         AND id = $1`,
      [created[0].id],
    );
    // Task was just created -- it must NOT be picked up yet
    expect(gkeResult).toHaveLength(0);
  });

  it("transitions through full lifecycle: pending -> running -> completed", async () => {
    const { rows } = await pool.query(
      `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by)
       VALUES ('lifecycle test', 'general', 're-cinq/lore', 'integration-test')
       RETURNING id`,
    );
    const id = rows[0].id;

    await pool.query(
      `UPDATE pipeline.tasks SET status = 'running', claimed_by = 'test-agent', claimed_at = now() WHERE id = $1`,
      [id],
    );
    const { rows: running } = await pool.query(
      `SELECT status FROM pipeline.tasks WHERE id = $1`,
      [id],
    );
    expect(running[0].status).toBe("running");

    await pool.query(
      `UPDATE pipeline.tasks SET status = 'completed', pr_url = 'https://github.com/test/pr/1' WHERE id = $1`,
      [id],
    );
    const { rows: completed } = await pool.query(
      `SELECT status, pr_url FROM pipeline.tasks WHERE id = $1`,
      [id],
    );
    expect(completed[0].status).toBe("completed");
    expect(completed[0].pr_url).toBe("https://github.com/test/pr/1");
  });

  it("records task events for audit trail", async () => {
    const { rows } = await pool.query(
      `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by)
       VALUES ('event test', 'general', 're-cinq/lore', 'integration-test')
       RETURNING id`,
    );
    const taskId = rows[0].id;

    await pool.query(
      `INSERT INTO pipeline.task_events (task_id, from_status, to_status, metadata)
       VALUES ($1, 'pending', 'running', '{"agent": "test-agent"}')`,
      [taskId],
    );
    await pool.query(
      `INSERT INTO pipeline.task_events (task_id, from_status, to_status)
       VALUES ($1, 'running', 'completed')`,
      [taskId],
    );

    const { rows: events } = await pool.query(
      `SELECT from_status, to_status FROM pipeline.task_events
       WHERE task_id = $1 ORDER BY created_at`,
      [taskId],
    );
    expect(events).toHaveLength(2);
    expect(events[0].from_status).toBe("pending");
    expect(events[0].to_status).toBe("running");
    expect(events[1].to_status).toBe("completed");
  });

  it("handles failure with reason", async () => {
    const { rows } = await pool.query(
      `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by)
       VALUES ('fail test', 'implementation', 're-cinq/lore', 'integration-test')
       RETURNING id`,
    );
    const id = rows[0].id;

    await pool.query(
      `UPDATE pipeline.tasks SET status = 'failed', failure_reason = 'Claude Code exited with code 1' WHERE id = $1`,
      [id],
    );

    const { rows: failed } = await pool.query(
      `SELECT status, failure_reason FROM pipeline.tasks WHERE id = $1`,
      [id],
    );
    expect(failed[0].status).toBe("failed");
    expect(failed[0].failure_reason).toContain("exited with code 1");
  });

  it("tracks review iterations", async () => {
    const { rows } = await pool.query(
      `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, review_iteration)
       VALUES ('review test', 'review', 're-cinq/lore', 'integration-test', 0)
       RETURNING id`,
    );
    const id = rows[0].id;

    // Increment review iteration (as watcher does after CHANGES_REQUESTED)
    await pool.query(
      `UPDATE pipeline.tasks SET review_iteration = review_iteration + 1 WHERE id = $1`,
      [id],
    );

    const { rows: updated } = await pool.query(
      `SELECT review_iteration FROM pipeline.tasks WHERE id = $1`,
      [id],
    );
    expect(updated[0].review_iteration).toBe(1);
  });

  it("creates tasks with default priority 'normal'", async () => {
    const { rows } = await pool.query(
      `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by)
       VALUES ('priority default test', 'general', 're-cinq/lore', 'integration-test')
       RETURNING id, priority`,
    );
    expect(rows[0].priority).toBe("normal");
  });

  it("creates tasks with explicit priority 'immediate'", async () => {
    const { rows } = await pool.query(
      `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, priority)
       VALUES ('priority immediate test', 'general', 're-cinq/lore', 'integration-test', 'immediate')
       RETURNING id, priority`,
    );
    expect(rows[0].priority).toBe("immediate");
  });

  it("GKE worker query picks up immediate tasks without grace period", async () => {
    const { rows: created } = await pool.query(
      `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, priority)
       VALUES ('immediate pickup test', 'general', 're-cinq/lore', 'integration-test', 'immediate')
       RETURNING id`,
    );

    // Immediate tasks should be picked up even when just created (no 30s grace period)
    const { rows: picked } = await pool.query(
      `SELECT id FROM pipeline.tasks
       WHERE status = 'pending'
         AND status != 'running-local'
         AND (
           (priority = 'immediate')
           OR (created_at < now() - interval '30 seconds')
         )
         AND id = $1`,
      [created[0].id],
    );
    expect(picked).toHaveLength(1);
  });

  it("run-now: updates priority from normal to immediate", async () => {
    const { rows: created } = await pool.query(
      `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, priority)
       VALUES ('run-now test', 'general', 're-cinq/lore', 'integration-test', 'normal')
       RETURNING id`,
    );
    const id = created[0].id;

    await pool.query(
      `UPDATE pipeline.tasks SET priority = 'immediate', updated_at = now() WHERE id = $1 AND status = 'pending'`,
      [id],
    );

    const { rows: updated } = await pool.query(
      `SELECT priority FROM pipeline.tasks WHERE id = $1`,
      [id],
    );
    expect(updated[0].priority).toBe("immediate");
  });
});
