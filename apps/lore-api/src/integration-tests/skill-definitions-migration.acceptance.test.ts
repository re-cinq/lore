import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

describe("lore.skill_definitions table structure", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: process.env.LORE_DB_NAME || "lore",
      user: process.env.LORE_DB_USER || "lore",
      password: process.env.LORE_DB_PASSWORD || "test",
    });
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it("creates lore.skill_definitions with the correct columns ([validated by this](specs/org-skills/spec.md#L15))", async () => {
    const res = await pool.query(`
      SELECT column_name
      FROM information_schema.columns 
      WHERE table_schema = 'lore' AND table_name = 'skill_definitions'
    `);

    const columns = res.rows.map((r) => r.column_name);

    expect(columns).toEqual(
      expect.arrayContaining([
        "name",
        "title",
        "description",
        "model",
        "content",
        "enabled",
        "project_id",
      ]),
    );
  });
});
