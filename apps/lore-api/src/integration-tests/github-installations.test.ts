import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "@hapi/hapi";
import pg from "pg";
import { buildServer } from "../app/build-server.js";
import { restoreEnv } from "./restore-env.js";

const INGEST_TOKEN = "integration-ingest-token";

describe("recording a GitHub installation, over HTTP", () => {
  let pool: pg.Pool;
  let server: Server;
  const prevIngest = process.env.LORE_INGEST_TOKEN;

  beforeAll(async () => {
    process.env.LORE_INGEST_TOKEN = INGEST_TOKEN;
    pool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: process.env.LORE_DB_NAME || "lore_test",
      user: process.env.LORE_DB_USER || "lore",
      password: process.env.LORE_DB_PASSWORD || "test",
    });
    await pool.query("SELECT 1");
    server = buildServer(() => pool);
  });

  afterAll(async () => {
    await server.stop();
    await pool.end();

    restoreEnv("LORE_INGEST_TOKEN", prevIngest);
  });

  it("refuses a request that carries no bearer token with 401", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/github/installations",
      payload: { installation_id: 81234567 },
    });

    expect({ statusCode: res.statusCode }).toEqual({ statusCode: 401 });
  });

  it("refuses an installation id of not-a-number with 400 before GitHub is asked", async () => {
    const res = await server.inject({
      method: "POST",
      url: "/api/github/installations",
      headers: { authorization: `Bearer ${INGEST_TOKEN}` },
      payload: { installation_id: "not-a-number" },
    });

    expect({ statusCode: res.statusCode }).toEqual({ statusCode: 400 });
  });
});
