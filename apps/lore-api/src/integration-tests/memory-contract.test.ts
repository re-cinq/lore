import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "@hapi/hapi";
import pg from "pg";
import { buildServer } from "../server/build-server.js";
import { restoreEnv } from "./restore-env.js";
import { setMemoryPool } from "@re-cinq/lore-server-core/features/memory/memory.js";
import { MemoryOperationSchema } from "../api/routes/memory/memory.js";

const TOKEN = "test-memory-contract-token";
const AGENT = "integration-test-memory";
const KEY = "contract-note";

describe("POST /api/memory answers what it declares", () => {
  let pool: pg.Pool;
  let server: Server;
  const prevToken = process.env.LORE_INGEST_TOKEN;

  const post = async (body: Record<string, unknown>) => {
    const res = await server.inject({
      method: "POST",
      url: "/api/memory",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: JSON.stringify({ agent_id: AGENT, ...body }),
    });

    expect(res.statusCode).toBe(200);

    return MemoryOperationSchema.safeParse(JSON.parse(res.payload));
  };

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
    setMemoryPool(pool);
    server = buildServer(() => pool);
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM memory.memory_versions WHERE memory_id IN
         (SELECT id FROM memory.memories WHERE agent_id = $1)`,
      [AGENT],
    );
    await pool.query("DELETE FROM memory.memories WHERE agent_id = $1", [
      AGENT,
    ]);
    await pool.query("DELETE FROM memory.audit_log WHERE agent_id = $1", [
      AGENT,
    ]);
    setMemoryPool(null);
    await pool.end();

    restoreEnv("LORE_INGEST_TOKEN", prevToken);
  });

  it("write returns the row it landed", async () => {
    const first = await post({
      action: "write",
      key: KEY,
      value: "use --set-string",
    });
    const second = await post({
      action: "write",
      key: KEY,
      value: "and never --set",
    });

    expect(first.error?.issues).toBeUndefined();
    expect(second.error?.issues).toBeUndefined();
    expect(second.data).toMatchObject({ key: KEY, version: 2 });
  });

  it("read returns the latest version", async () => {
    const latest = await post({ action: "read", key: KEY });

    expect(latest.error?.issues).toBeUndefined();
    expect(latest.data).toMatchObject({ key: KEY, value: "and never --set" });
  });

  it("read of one version returns that version, key included", async () => {
    const one = await post({ action: "read", key: KEY, version: 1 });

    expect(one.error?.issues).toBeUndefined();
    expect(one.data).toMatchObject({ key: KEY, version: 1 });
  });

  it("read of every version returns the history", async () => {
    const all = await post({ action: "read", key: KEY, version: "all" });

    expect(all.error?.issues).toBeUndefined();
    expect(all.data).toHaveLength(2);
  });

  it("search returns ranked hits that name their source", async () => {
    const hits = await post({ action: "search", query: "set-string" });

    expect(hits.error?.issues).toBeUndefined();
  });

  it("list returns the page it was asked for", async () => {
    const page = await post({ action: "list", limit: 10, offset: 0 });

    expect(page.error?.issues).toBeUndefined();
    expect(page.data).toMatchObject({ limit: 10, offset: 0 });
  });

  it("delete acknowledges the key it removed", async () => {
    const removed = await post({ action: "delete", key: KEY });

    expect(removed.error?.issues).toBeUndefined();
    expect(removed.data).toEqual({ key: KEY, deleted: true });
  });
});
