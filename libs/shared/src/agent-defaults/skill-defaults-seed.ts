import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import type { PgPool } from "../domain/memory-store-types.js";

const SKILLS_DIR = fileURLToPath(
  new URL("../../../../apps/mcp-server/agent-skills/skills", import.meta.url),
);

export async function seedSkillDefaults(pool: PgPool): Promise<void> {
  const skills = ["lore-context", "tdd-loop", "legacy-characterize"];
  for (const skillName of skills) {
    await processSkill(pool, skillName);
  }
}

async function processSkill(pool: PgPool, skillName: string): Promise<void> {
  const skillPath = join(SKILLS_DIR, skillName, "SKILL.md");

  let content: string;
  try {
    content = readFileSync(skillPath, "utf-8");
  } catch (_e) {
    return;
  }

  const { body, result } = extractFrontmatter(content);
  if (
    !body.includes("<!-- lore-help:begin -->") ||
    !body.includes("<!-- lore-help:end -->")
  ) {
    throw new Error(`Skill ${skillName} is missing a ## Help block`);
  }

  await insertSkillDefinition(pool, {
    name: result.name || skillName,
    title: result.title || skillName,
    description: result.description || "",
    body,
  });
}

function extractFrontmatter(content: string) {
  let body = content;
  const result: Record<string, string> = {};

  if (!content.startsWith("---")) return { body, result };

  const endIdx = content.indexOf("---", 3);
  if (endIdx === -1) return { body, result };

  const frontmatter = content.slice(3, endIdx);
  body = content.slice(endIdx + 3).trim();
  const parsed = parse(frontmatter);
  return {
    body,
    result: (parsed as Record<string, string> | null) ?? {},
  };
}

async function insertSkillDefinition(
  pool: PgPool,
  skill: { name: string; title: string; description: string; body: string },
) {
  await pool.query(
    `
    INSERT INTO lore.skill_definitions (name, title, description, model, content, enabled, project_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (name) WHERE project_id IS NULL DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      content = EXCLUDED.content,
      enabled = EXCLUDED.enabled
    `,
    [skill.name, skill.title, skill.description, null, skill.body, true, null],
  );
}
