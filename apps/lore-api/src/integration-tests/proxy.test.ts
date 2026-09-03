import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "@hapi/hapi";
import pg from "pg";
import { buildServer } from "../server/build-server.js";
import { restoreEnv } from "./restore-env.js";
import { proxyToApi, proxyGetApi } from "@re-cinq/lore-server-core/proxy.js";

const TOKEN = "test-proxy-token";
const TEST_REPO = "test/proxy-repo";

type ProxyOk = { ok: true; body: string };

describe("mcp-server proxy <-> lore-api round-trip", () => {
  let pool: pg.Pool;
  let server: Server;
  let port: number | string;
  let taskId: string;
  const prevApiUrl = process.env.LORE_API_URL;
  const prevToken = process.env.LORE_INGEST_TOKEN;

  beforeAll(async () => {
    pool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: process.env.LORE_DB_NAME || "lore_test",
      user: process.env.LORE_DB_USER || "lore",
      password: process.env.LORE_DB_PASSWORD || "test",
    });
    await pool.query("SELECT 1");

    server = buildServer(() => pool);
    await server.start();
    port = server.info.port;

    process.env.LORE_API_URL = `http://127.0.0.1:${port}`;
    process.env.LORE_INGEST_TOKEN = TOKEN;

    await pool.query(
      `INSERT INTO lore.repos (owner, name, full_name, onboarding_pr_merged)
       VALUES ('test', 'proxy-repo', $1, true)
       ON CONFLICT (full_name) DO NOTHING`,
      [TEST_REPO],
    );
    const { rows } = await pool.query(
      `INSERT INTO pipeline.tasks (description, task_type, target_repo, created_by, status, priority)
       VALUES ('proxy seam task', 'general', $1, 'integration-test-proxy', 'pending', 'normal')
       RETURNING id`,
      [TEST_REPO],
    );

    taskId = rows[0].id;
  });

  afterAll(async () => {
    await pool.query(
      "DELETE FROM pipeline.tasks WHERE created_by = 'integration-test-proxy'",
    );
    await pool.query("DELETE FROM lore.repos WHERE full_name = $1", [
      TEST_REPO,
    ]);
    await server.stop();
    await pool.end();

    restoreEnv("LORE_API_URL", prevApiUrl);

    restoreEnv("LORE_INGEST_TOKEN", prevToken);
  });

  it("proxies a GET read to lore-api and parses the DB response", async () => {
    const result = await proxyGetApi("/api/repos");

    expect(result.ok).toBe(true);
    const body = JSON.parse((result as ProxyOk).body) as {
      repos: Array<{ full_name: string }>;
    };

    expect(body.repos.map((r) => r.full_name)).toContain(TEST_REPO);
  });

  it("proxies a POST write to lore-api and the change persists in the DB", async () => {
    const result = await proxyToApi("/api/task", {
      action: "set-priority",
      task_id: taskId,
      priority: "immediate",
    });

    expect(result.ok).toBe(true);
    expect(JSON.parse((result as ProxyOk).body)).toMatchObject({
      ok: true,
      task_id: taskId,
      priority: "immediate",
    });
    const { rows } = await pool.query(
      "SELECT priority FROM pipeline.tasks WHERE id = $1",
      [taskId],
    );

    expect(rows[0].priority).toBe("immediate");
  });

  it("returns not_configured when no API URL is set", async () => {
    delete process.env.LORE_API_URL;

    try {
      expect(
        await proxyToApi("/api/task", {
          action: "set-priority",
          task_id: taskId,
          priority: "normal",
        }),
      ).toMatchObject({ ok: false, reason: "not_configured" });
    } finally {
      process.env.LORE_API_URL = `http://127.0.0.1:${port}`;
    }
  });
});
