import { loadSkillDefaults } from "@re-cinq/lore-shared/agent-defaults/skill-defaults-files.js";
import { seedSkillDefaults } from "@re-cinq/lore-shared/agent-defaults/skill-defaults-seed.js";
import { hasValidHelpBlock } from "@re-cinq/lore-shared/agent-defaults/skill-help-block.js";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

describe("seedSkillDefaults (Acceptance)", () => {
  const skills = loadSkillDefaults();
  const skillNames = skills.map((skill) => skill.name);
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
    await pool.query(
      `DELETE FROM lore.skill_definitions WHERE project_id IS NULL AND name = ANY($1)`,
      [skillNames],
    );
    await pool.end();
  });

  it("seeds the 22 shipped skills with a valid Help block into lore.skill_definitions", async () => {
    await seedSkillDefaults(pool, skills);

    const { rows } = await pool.query<{ name: string; content: string }>(
      `SELECT name, content FROM lore.skill_definitions WHERE project_id IS NULL AND name = ANY($1) ORDER BY name`,
      [skillNames],
    );

    expect({
      names: rows.map((row) => row.name),
      withoutValidHelp: rows
        .filter((row) => !hasValidHelpBlock(row.content))
        .map((row) => row.name),
    }).toEqual({ names: skillNames, withoutValidHelp: [] });
    expect(skillNames).toHaveLength(22);
  });

  it("keeps an edited and disabled skill when the shipped skills are seeded again", async () => {
    await seedSkillDefaults(pool, skills);
    await pool.query(
      `UPDATE lore.skill_definitions SET content = 'edited by an admin', enabled = false WHERE project_id IS NULL AND name = 'testing'`,
    );

    await seedSkillDefaults(pool, skills);

    const { rows } = await pool.query<{ content: string; enabled: boolean }>(
      `SELECT content, enabled FROM lore.skill_definitions WHERE project_id IS NULL AND name = 'testing'`,
    );

    expect(rows).toEqual([{ content: "edited by an admin", enabled: false }]);
  });
});
