import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "@hapi/hapi";
import pg from "pg";
import { buildServer } from "../server/build-server.js";

/**
 * `ENRICH_SELECT` is the one query the run reads WRITE rather than move: the
 * `unnest` join onto the ids the port selected, the LATERAL cost fallback for
 * calls that predate per-line attribution, and the `created_by` COALESCE.
 *
 * The route's own tests answer the pool from a mock, so every enriched field is
 * whatever the mock says — which proves the mapping and nothing about the SQL.
 * This runs it against a migrated Postgres, with real rows in the three tables
 * it joins.
 */
const TOKEN = "test-enrichment-token";
const REPO = "test/enrichment-repo";
const CREATED_BY = "integration-test-enrichment";

interface RunRow {
  id: string;
  cost_usd: number | null;
  pr_url: string | null;
  task_pr_number: number | null;
  created_by: string | null;
  args_pr_number: number | null;
}

describe("the run reads' enrichment query", () => {
  let pool: pg.Pool;
  let server: Server;
  let runId: string;
  let taskId: string;
  const prevToken = process.env.LORE_INGEST_TOKEN;

  beforeAll(async () => {
    process.env.LORE_INGEST_TOKEN = TOKEN;
    pool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: process.env.LORE_DB_NAME || "lore_test",
      user: process.env.LORE_DB_USER || "lore",
      password: process.env.LORE_DB_PASSWORD || "test",
    });
    await pool.query("SELECT 1");
    server = buildServer(() => pool);

    const task = await pool.query<{ id: string }>(
      `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, pr_url, pr_number)
       VALUES ('enrichment fixture', 'general', $1, $2, 'https://github.com/test/enrichment-repo/pull/7', 7)
       RETURNING id`,
      [REPO, CREATED_BY],
    );

    taskId = task.rows[0].id;

    const run = await pool.query<{ id: string }>(
      `INSERT INTO pipeline.assembly_runs (blueprint_name, repo, task_id, args, status)
       VALUES ('code-review', $1, $2, '{"pr_number": 7, "actor": "someone-else"}'::jsonb, 'running')
       RETURNING id`,
      [REPO, taskId],
    );

    runId = run.rows[0].id;

    // One call attributed to the run, one attributed only to its task — the
    // LATERAL fallback is what keeps the second from silently zeroing a run
    // started before `llm_calls.assembly_line_id` existed.
    await pool.query(
      `INSERT INTO pipeline.llm_calls
         (task_id, assembly_line_id, model, input_tokens, output_tokens, cost_usd, duration_ms)
       VALUES ($1, $2, 'claude-opus-5', 10, 20, 0.75, 100),
              ($1, NULL, 'claude-opus-5', 10, 20, 0.50, 100)`,
      [taskId, runId],
    );
  });

  afterAll(async () => {
    await pool.query("DELETE FROM pipeline.llm_calls WHERE task_id = $1", [
      taskId,
    ]);
    await pool.query("DELETE FROM pipeline.assembly_runs WHERE id = $1", [
      runId,
    ]);
    await pool.query("DELETE FROM pipeline.tasks WHERE created_by = $1", [
      CREATED_BY,
    ]);
    await server.stop();
    await pool.end();

    if (prevToken === undefined) {
      delete process.env.LORE_INGEST_TOKEN;
    } else {
      process.env.LORE_INGEST_TOKEN = prevToken;
    }
  });

  const listed = async (): Promise<RunRow> => {
    const res = await server.inject({
      method: "GET",
      url: `/api/assembly-runs?repo=${encodeURIComponent(REPO)}&limit=5`,
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(res.statusCode).toBe(200);

    return (JSON.parse(res.payload) as { runs: RunRow[] }).runs[0];
  };

  it("carries the task's PR onto the run that produced it", async () => {
    expect(await listed()).toMatchObject({
      id: runId,
      pr_url: "https://github.com/test/enrichment-repo/pull/7",
      task_pr_number: 7,
      args_pr_number: 7,
    });
  });

  it("sums the run's own calls and the task's unattributed ones", async () => {
    expect((await listed()).cost_usd).toBeCloseTo(1.25, 6);
  });

  it("prefers the task's author over the actor in args", async () => {
    expect((await listed()).created_by).toEqual(CREATED_BY);
  });
});
