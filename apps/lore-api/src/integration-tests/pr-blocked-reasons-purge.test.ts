import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { prunePrBlockedReasons } from "@re-cinq/lore-shared/housekeeping/pr-blocked-reasons-retention.js";

const REPO = "re-cinq/purge-fixture";

describe("prunePrBlockedReasons against pipeline.pr_blocked_reasons", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: process.env.LORE_DB_NAME || "lore",
      user: process.env.LORE_DB_USER || "lore",
      password: process.env.LORE_DB_PASSWORD || "test",
    });
    await pool.query(
      "DELETE FROM pipeline.pr_blocked_reasons WHERE repo = $1",
      [REPO],
    );
    await pool.query(
      `INSERT INTO pipeline.pr_blocked_reasons (repo, pr_number, reason, closed_at) VALUES
         ($1, 31, 'waiting_on_ci', now() - interval '31 days'),
         ($1, 29, 'waiting_on_ci', now() - interval '29 days'),
         ($1, 1, 'waiting_on_ci', NULL)`,
      [REPO],
    );
  });

  afterAll(async () => {
    await pool?.query(
      "DELETE FROM pipeline.pr_blocked_reasons WHERE repo = $1",
      [REPO],
    );
    await pool?.end();
  });

  it("deletes the row closed 31 days ago and keeps the one closed 29 days ago and the open one", async () => {
    await prunePrBlockedReasons(pool);

    const { rows } = await pool.query(
      "SELECT pr_number FROM pipeline.pr_blocked_reasons WHERE repo = $1 ORDER BY pr_number",
      [REPO],
    );

    expect(rows.map((r) => Number(r.pr_number))).toEqual([1, 29]);
  });
});
