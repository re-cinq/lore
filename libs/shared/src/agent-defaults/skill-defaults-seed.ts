import { enforceTrue } from "../lib/enforce.js";
import type { PgPool } from "../domain/memory-store-types.js";
import type { SkillFile } from "./skill-file.js";
import { hasValidHelpBlock } from "./skill-help-block.js";

const INSERT_MISSING_SKILL_SQL = `
    INSERT INTO lore.skill_definitions (name, title, description, model, content, enabled, project_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (name) WHERE project_id IS NULL DO NOTHING
    `;

export async function seedSkillDefaults(
  pool: PgPool,
  skills: SkillFile[] = [],
): Promise<void> {
  skills.forEach((skill) =>
    enforceTrue(
      hasValidHelpBlock(skill.content),
      Error,
      `Skill ${skill.name} is missing a valid ## Help block`,
    ),
  );

  await Promise.all(
    skills.map((skill) => insertMissingSkillDefinition(pool, skill)),
  );
}

async function insertMissingSkillDefinition(
  pool: PgPool,
  skill: SkillFile,
): Promise<void> {
  await pool.query(INSERT_MISSING_SKILL_SQL, [
    skill.name,
    skill.title,
    skill.description,
    skill.model,
    skill.content,
    true,
    null,
  ]);
}
