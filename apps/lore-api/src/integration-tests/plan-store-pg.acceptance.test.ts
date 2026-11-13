import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import {
  pgPlanStore,
  listCrossRepoPlanMetas,
} from "../outbound/plans/plan-store-pg.js";

describe("plan-store-pg cross-repository retrieval", () => {
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
    await pool.query("DELETE FROM lore.plans WHERE repo LIKE 'acme/%'");
    await pool.end();
  });

  it("returns eligible plans across the given authorized repositories", async () => {
    const store = pgPlanStore(() => pool);
    const plan1 = await store.createPlan({
      repo: "acme/repo1",
      title: "Cross-repo plan 1",
      type: "feature",
      createdBy: "alice",
    });

    await store.updateMeta(plan1.id, { status: "in-review" });

    const plan2 = await store.createPlan({
      repo: "acme/repo2",
      title: "Cross-repo plan 2",
      type: "feature",
      createdBy: "bob",
    });

    await store.updateMeta(plan2.id, { status: "in-review" });

    const results = await listCrossRepoPlanMetas(
      () => pool,
      ["acme/repo1", "acme/repo2"],
    );

    expect(results).toBeDefined();
    const ids = results.map((r: any) => r.id);

    expect(ids).toContain(plan1.id);
    expect(ids).toContain(plan2.id);
  });
});
