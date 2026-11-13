import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

describe("lore.inbox_item_state table structure", () => {
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

  it("creates lore.inbox_item_state with the correct columns ([validated by this](specs/inbox/spec.md#L135))", async () => {
    const res = await pool.query(`
      SELECT column_name
      FROM information_schema.columns 
      WHERE table_schema = 'lore' AND table_name = 'inbox_item_state'
    `);

    const columns = res.rows.map((r) => r.column_name);

    const pkRes = await pool.query(`
      SELECT a.attname
      FROM   pg_index i
      JOIN   pg_attribute a ON a.attrelid = i.indrelid
                           AND a.attnum = ANY(i.indkey)
      WHERE  i.indrelid = 'lore.inbox_item_state'::regclass
      AND    i.indisprimary;
    `);

    const pkColumns = pkRes.rows.map((r) => r.attname);

    expect({ columns, pkColumns }).toEqual({
      columns: expect.arrayContaining([
        "person",
        "item_id",
        "handled_at",
        "snoozed_until",
        "updated_at",
      ]),
      pkColumns: expect.arrayContaining(["person", "item_id"]),
    });
  });
});
