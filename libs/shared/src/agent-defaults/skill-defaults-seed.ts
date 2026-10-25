import { readdirSync, readFileSync } from "node:fs";
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
    const skillPath = join(SKILLS_DIR, skillName, "SKILL.md");
    let content = "";
    try {
      content = readFileSync(skillPath, "utf-8");
    } catch (e) {
      continue; // Skip if file not found
    }

    // Parse frontmatter
    let name = skillName;
    let title = skillName;
    let description = "";
    let body = content;

    if (content.startsWith("---")) {
      const endIdx = content.indexOf("---", 3);
      if (endIdx !== -1) {
        const frontmatter = content.slice(3, endIdx);
        body = content.slice(endIdx + 3).trim();
        const parsed = (parse(frontmatter) as Record<string, string>) || {};
        if (parsed.name) name = parsed.name;
        if (parsed.title) title = parsed.title;
        if (parsed.description) description = parsed.description;
      }
    }

    if (
      !body.includes("<!-- lore-help:begin -->") ||
      !body.includes("<!-- lore-help:end -->")
    ) {
      throw new Error(`Skill ${skillName} is missing a ## Help block`);
    }

    await pool.query(
      `
      INSERT INTO lore.skill_definitions (name, title, description, model, content, enabled, project_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (name, project_id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        content = EXCLUDED.content,
        enabled = EXCLUDED.enabled
      `,
      [name, title, description, null, body, true, null],
    );
  }
}
