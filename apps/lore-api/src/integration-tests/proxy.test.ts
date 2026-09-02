import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "@hapi/hapi";
import pg from "pg";
import { buildServer } from "../server/build-server.js";
import { restoreEnv } from "./restore-env.js";
import { proxyToApi, proxyGetApi } from "@re-cinq/lore-server-core/proxy.js";

// Proxy seam introduced by the local/remote split (ADR-032). The lean
// mcp-server holds no database — every data operation leaves it through the
// server-core proxy client (`proxyToApi` / `proxyGetApi`, the exact functions
// mcp-server's tool modules import from "@re-cinq/lore-server-core/proxy.js")
// over HTTP to the remote lore-api, which authenticates the bearer and serves
// from Postgres.
//
// These tests stand up the REAL lore-api server (buildServer — the same factory
// production boots, hapi in front of the legacy dispatcher) against the test DB
// and drive the REAL proxy client at it. That boundary is invisible to both unit
// suites: mcp-server's has no server to talk to, lore-api's never goes through
// the proxy.

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

    // Point the proxy client at the real server, as install.sh configures the
    // local MCP adapter against the remote API.
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
    // Like mcp-server's repo-list tool: proxyGetApi("/api/repos") then read the
    // paged { repos, total } envelope.
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

  // No server-side 401/403 ("denied") case here on purpose: the proxy client
  // sends LORE_INGEST_TOKEN and lore-api treats that same var as its full-access
  // legacy token. In production they are separate processes; in one test process
  // they are one variable, so the client can never present a token the server
  // rejects. The 403 -> reason:"denied" mapping is covered by a unit test of the
  // proxy client with a mocked fetch, not here.

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
