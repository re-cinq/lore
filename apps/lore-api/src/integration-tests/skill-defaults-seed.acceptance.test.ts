import { loadSkillDefaults } from "@re-cinq/lore-shared/agent-defaults/skill-defaults-files.js";
import { seedSkillDefaults } from "@re-cinq/lore-shared/agent-defaults/skill-defaults-seed.js";
import { applySkillRevisions } from "@re-cinq/lore-shared/agent-defaults/skill-revisions.js";
import { hasValidHelpBlock } from "@re-cinq/lore-shared/agent-defaults/skill-help-block.js";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";

const REVISION_VERSION = "skills/acceptance_test_revision";

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
    await pool.query(`DELETE FROM lore.schema_migrations WHERE version = $1`, [
      REVISION_VERSION,
    ]);
    await pool.end();
  });

  it("seeds the 29 shipped skills with a valid Help block into lore.skill_definitions", async () => {
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
    expect(skillNames).toHaveLength(29);
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

  it("replaces the stored org row once per revision and keeps enabled when the revision is applied", async () => {
    const revision = [{ version: REVISION_VERSION, names: ["testing"] }];

    await seedSkillDefaults(pool, skills);
    await pool.query(
      `UPDATE lore.skill_definitions SET content = 'old shipped text', enabled = false WHERE project_id IS NULL AND name = 'testing'`,
    );

    const first = await applySkillRevisions(pool, skills, revision);

    await pool.query(
      `UPDATE lore.skill_definitions SET content = 'edited after the revision' WHERE project_id IS NULL AND name = 'testing'`,
    );
    const second = await applySkillRevisions(pool, skills, revision);

    const { rows } = await pool.query<{ content: string; enabled: boolean }>(
      `SELECT content, enabled FROM lore.skill_definitions WHERE project_id IS NULL AND name = 'testing'`,
    );

    expect({ first, second, rows }).toEqual({
      first: [REVISION_VERSION],
      second: [],
      rows: [{ content: "edited after the revision", enabled: false }],
    });
  });

  it("writes the shipped text into the stored row when the revision is applied", async () => {
    await pool.query(`DELETE FROM lore.schema_migrations WHERE version = $1`, [
      REVISION_VERSION,
    ]);
    await pool.query(
      `UPDATE lore.skill_definitions SET content = 'old shipped text' WHERE project_id IS NULL AND name = 'testing'`,
    );

    await applySkillRevisions(pool, skills, [
      { version: REVISION_VERSION, names: ["testing"] },
    ]);

    const { rows } = await pool.query<{ content: string }>(
      `SELECT content FROM lore.skill_definitions WHERE project_id IS NULL AND name = 'testing'`,
    );

    expect(rows).toEqual([
      { content: skills.find((skill) => skill.name === "testing")?.content },
    ]);
  });
});
