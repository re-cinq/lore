import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { checkPlanStore } from "@re-cinq/planning-sync/testing";
import { pgPlanStore } from "../outbound/plans/plan-store-pg.js";

describe("pgPlanStore", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: process.env.LORE_DB_NAME || "lore_test",
      user: process.env.LORE_DB_USER || "lore",
      password: process.env.LORE_DB_PASSWORD || "test",
    });
  });

  afterAll(async () => {
    await pool.query("DELETE FROM lore.plans WHERE repo = 'acme/shop'");
    await pool.end();
  });

  it("passes every check of the planning-sync PlanStore contract", async () => {
    expect(await checkPlanStore(pgPlanStore(() => pool))).toEqual([]);
  });
});
