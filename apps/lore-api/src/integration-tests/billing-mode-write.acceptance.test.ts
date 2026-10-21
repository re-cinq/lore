import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { PgAssemblyRuns } from "../../../../libs/shared/src/outbound/project/assembly-runs/assembly-runs-pg.js";
import { PgUsage } from "../../../../libs/shared/src/outbound/project/usage/usage-pg.js";
import { buildServer } from "../app/build-server.js";
import type { Server } from "@hapi/hapi";
import crypto from "crypto";

const TOKEN = "test-billing-mode-token";

describe("Billing mode write path", () => {
  let pool: pg.Pool;
  let server: Server;
  const runId = crypto.randomUUID();

  beforeAll(async () => {
    process.env.LORE_INGEST_TOKEN = TOKEN;
    pool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: process.env.LORE_DB_NAME || "lore_test",
      user: process.env.LORE_DB_USER || "lore",
      password: process.env.LORE_DB_PASSWORD || "test",
    });
    server = buildServer(() => pool);

    await pool.query(
      "INSERT INTO pipeline.assembly_runs (id, repo, branch, blueprint_name) VALUES ($1, 'test/repo', 'main', 'test-blueprint')",
      [runId],
    );
  });

  afterAll(async () => {
    await pool.query("DELETE FROM pipeline.assembly_runs WHERE id = $1", [
      runId,
    ]);
    await pool.end();
  });

  it("records the billing mode at dispatch and joins it into the cost row", async () => {
    const assemblyRuns = new PgAssemblyRuns(pool);
    const usage = new PgUsage(pool);

    const { stationRunId } = await assemblyRuns.ensureStationRun({
      assemblyRunId: runId,
      nodeId: "test-node",
      iteration: 1,
      billingMode: "subscription",
    });

    await usage.logLlmCall({
      model: "claude-3-5-sonnet-20241022",
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 2.5,
      durationMs: 1000,
      carried: {
        assemblyRunId: runId,
        nodeId: "test-node",
        iteration: 1,
        stationRunId,
      },
    });

    const res = await server.inject({
      method: "GET",
      url: "/api/analytics/spend-window?since=1h",
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);

    expect(body.llm.by_billing_mode).toContainEqual(
      expect.objectContaining({ mode: "subscription", cost_usd: 2.5 }),
    );
  });
});
