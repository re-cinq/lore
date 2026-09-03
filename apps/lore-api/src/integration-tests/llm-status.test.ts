import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "@hapi/hapi";
import pg from "pg";
import { buildServer } from "../server/build-server.js";
import { restoreEnv } from "./restore-env.js";

const TOKEN = "test-llm-status-token";
const REPO = "test/llm-status-repo";

describe("the llm-status recent-failure query", () => {
  let pool: pg.Pool;
  let server: Server;
  let runIds: string[] = [];
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

    const runs = await pool.query<{ id: string }>(
      `INSERT INTO pipeline.assembly_runs (blueprint_name, repo, status)
       VALUES ('code-review', $1, 'failed'), ('code-review', $1, 'failed')
       RETURNING id`,
      [REPO],
    );

    runIds = runs.rows.map((r) => r.id);

    await pool.query(
      `INSERT INTO pipeline.station_runs
         (assembly_run_id, node_id, iteration, outcome, failure_class, failure_detail, started_at, finished_at)
       VALUES ($1, 'review', 1, 'failed', 'anthropic-credit', 'zzz oldest — Credit balance is too low',
               now() - interval '20 minutes', now() - interval '20 minutes'),
              ($2, 'review', 1, 'failed', 'anthropic-credit', 'aaa newer — Credit balance is too low',
               now() - interval '5 minutes', now() - interval '5 minutes')`,
      runIds,
    );
  });

  afterAll(async () => {
    await pool.query(
      "DELETE FROM pipeline.station_runs WHERE assembly_run_id = ANY($1)",
      [runIds],
    );
    await pool.query("DELETE FROM pipeline.assembly_runs WHERE repo = $1", [
      REPO,
    ]);
    await server.stop();
    await pool.end();

    restoreEnv("LORE_INGEST_TOKEN", prevToken);
  });

  it("quotes the detail belonging to the failure it dates", async () => {
    const res = await server.inject({
      method: "GET",
      url: "/api/platform/llm-status",
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(res.statusCode).toEqual(200);
    expect(JSON.parse(res.payload)).toMatchObject({
      degraded: true,
      failure_class: "anthropic-credit",
      detail: "zzz oldest — Credit balance is too low",
      affected_runs: 2,
    });
  });
});
