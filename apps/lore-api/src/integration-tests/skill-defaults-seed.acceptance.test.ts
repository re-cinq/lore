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
    try {
      await pool.query(
        `DELETE FROM lore.skill_definitions WHERE name IN ('lore-context', 'tdd-loop', 'legacy-characterize')`,
      );
    } catch (_e) {}
    await pool.end();
  });

  it("seeds the three static skills with a Help block into lore.skill_definitions", async () => {
    const mod =
      await import("@re-cinq/lore-shared/agent-defaults/skill-defaults-seed.js").catch(
        () => null,
      );

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

    expect(
      rows.map((r) => ({
        hasHelp:
          r.content.includes("<!-- lore-help:begin -->") &&
          r.content.includes("<!-- lore-help:end -->"),
      })),
    ).toEqual([{ hasHelp: true }, { hasHelp: true }, { hasHelp: true }]);
  });
});
