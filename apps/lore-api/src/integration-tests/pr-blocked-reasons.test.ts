import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

describe("pipeline.pr_blocked_reasons", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: process.env.LORE_DB_NAME || "lore",
      user: process.env.LORE_DB_USER || "lore",
      password: process.env.LORE_DB_PASSWORD || "test",
    });
    await pool.query("SELECT 1");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("has the required columns", async () => {
    const { rows } = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'pipeline' AND table_name = 'pr_blocked_reasons'
    `);

    const columns = rows.map((r) => r.column_name);

    expect(columns).toEqual(
      expect.arrayContaining([
        "repo",
        "pr_number",
        "reason",
        "detail",
        "since",
        "updated_at",
        "closed_at",
      ]),
    );
  });
});
