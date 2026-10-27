import { enforceTrue } from "../lib/enforce.js";
import type { PgPool } from "../domain/memory-store-types.js";
import type { SkillFile } from "./skill-file.js";
import { hasValidHelpBlock } from "./skill-help-block.js";

const UPSERT_SKILL_SQL = `
    INSERT INTO lore.skill_definitions (name, title, description, model, content, enabled, project_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (name) WHERE project_id IS NULL DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      model = EXCLUDED.model,
      content = EXCLUDED.content,
      enabled = EXCLUDED.enabled
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

  await Promise.all(skills.map((skill) => upsertSkillDefinition(pool, skill)));
}

async function upsertSkillDefinition(
  pool: PgPool,
  skill: SkillFile,
): Promise<void> {
  await pool.query(UPSERT_SKILL_SQL, [
    skill.name,
    skill.title,
    skill.description,
    skill.model,
    skill.content,
    true,
    null,
  ]);
}
