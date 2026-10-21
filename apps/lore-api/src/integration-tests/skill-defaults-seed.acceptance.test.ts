import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

describe("seedSkillDefaults (Acceptance)", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({
      host: process.env.LORE_DB_HOST || "localhost",
      port: parseInt(process.env.LORE_DB_PORT || "5432"),
      database: process.env.LORE_DB_NAME || "lore_test",
      user: process.env.LORE_DB_USER || "lore",
      password: process.env.LORE_DB_PASSWORD || "lore",
    });
  });

  afterAll(async () => {
    // Delete the skills we seeded to clean up
    try {
      await pool.query(
        `DELETE FROM lore.skill_definitions WHERE name IN ('lore-context', 'tdd-loop', 'legacy-characterize')`,
      );
    } catch (e) {
      // Table might not exist yet
    }
    await pool.end();
  });

  it("seeds the three static skills with a Help block into lore.skill_definitions", async () => {
    // The module is absent, so we dynamically import to prevent the test suite from crashing
    const mod =
      await import("@re-cinq/lore-shared/agent-defaults/skill-defaults-seed.js").catch(
        () => null,
      );

    // Fallback if the path is in outbound/project/skills instead
    const altMod =
      await import("@re-cinq/lore-shared/project/skills/skill-defaults-seed.js").catch(
        () => null,
      );

    const seedModule = mod || altMod;
    expect(seedModule, "Skill seed module must be implemented").not.toBeNull();

    await seedModule.seedSkillDefaults(pool);

    const { rows } = await pool.query(
      `SELECT name, content FROM lore.skill_definitions WHERE name IN ('lore-context', 'tdd-loop', 'legacy-characterize')`,
    );

    expect(rows).toHaveLength(3);

    for (const row of rows) {
      expect(row.content).toContain("<!-- lore-help:begin -->");
      expect(row.content).toContain("<!-- lore-help:end -->");
    }
  });
});
