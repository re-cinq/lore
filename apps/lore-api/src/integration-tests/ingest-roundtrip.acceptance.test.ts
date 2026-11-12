import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { ingestFiles } from "../work/spec-trace/ingest.js";
import { createHash } from "node:crypto";

const REPO = "test/ingest-roundtrip";
const SCHEMA = "org_shared";

describe("Ingest round-trip", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: process.env.LORE_DB_NAME || "lore",
      user: process.env.LORE_DB_USER || "lore",
      password: process.env.LORE_DB_PASSWORD || "test",
    });
    await pool.query(`DELETE FROM ${SCHEMA}.chunks WHERE repo = $1`, [REPO]);
  });

  afterAll(async () => {
    await pool?.query(`DELETE FROM ${SCHEMA}.chunks WHERE repo = $1`, [REPO]);
    await pool?.end();
  });

  it("A chunk inserted through API ingest retains its exact content_hash when read back", async () => {
    const content = "const x = 42;";
    const filePath = "src/x.ts";

    const { results } = await ingestFiles(pool, [{ path: filePath, content }], {
      repo: REPO,
      commit: "HEAD",
    });

    const chunkId = results[0]?.chunk_id;

    expect(results).toMatchObject([{ status: "ingested" }]);

    const { rows } = await pool.query(
      `SELECT metadata FROM ${SCHEMA}.chunks WHERE id = $1`,
      [chunkId],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].metadata.content_hash).toBe(
      createHash("sha256").update(content).digest("hex"),
    );
  });
});
